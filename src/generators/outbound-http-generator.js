'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPascalCase, toCamelCase, toPackagePath } = require('../utils/naming');
const { readInternalApiYaml } = require('../utils/arch-yaml-reader');
const { resolveResilienceForBcHttp, resolveAuthForBcHttp } = require('../utils/resilience-auth-resolver');
const logger = require('../utils/logger');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates', 'infrastructure', 'adapters');

// ─── OpenAPI schema → Java type helpers ──────────────────────────────────────

/**
 * Maps an OpenAPI schema type/format pair to a Java type string.
 * Used for infra DTOs (records) — these mirror the wire format.
 */
function openApiTypeToJava(schema) {
  if (!schema) return 'Object';
  const { type, format } = schema;
  if (format === 'uuid') return 'String'; // path variables and IDs stay as String in infra DTOs
  if (type === 'string') return 'String';
  if (type === 'integer' && format === 'int64') return 'long';
  if (type === 'integer') return 'int';
  if (type === 'number' && format === 'double') return 'double';
  if (type === 'number') return 'java.math.BigDecimal';
  if (type === 'boolean') return 'boolean';
  if (type === 'array') {
    if (schema.items) return `List<${openApiTypeToJava(schema.items)}>`;
    return 'List<Object>';
  }
  return 'String'; // fallback
}

/**
 * Resolves a $ref string like "#/components/schemas/Money" to the schema name "Money".
 */
function resolveRefName(ref) {
  if (!ref) return null;
  const parts = ref.split('/');
  return parts[parts.length - 1];
}

/**
 * Fully resolves a schema (following $ref) from the OpenAPI components.
 */
function resolveSchema(schema, components) {
  if (!schema) return {};
  if (schema.$ref) {
    const name = resolveRefName(schema.$ref);
    return (components.schemas || {})[name] || {};
  }
  return schema;
}

function isObjectSchema(schema) {
  return !!schema && (schema.type === 'object' || !!schema.properties);
}

// ─── Schema → flat field list ─────────────────────────────────────────────────

/**
 * Converts an OpenAPI schema (object type) to a list of { name, javaType } fields.
 * Handles nested $ref schemas by using their name as the Java type (another DTO/record).
 */
function schemaToFields(schema, components, nestedDtoNames = new Set()) {
  const resolved = resolveSchema(schema, components);
  const properties = resolved.properties || {};
  return Object.entries(properties).map(([name, propSchema]) => {
    if (propSchema.$ref) {
      const refName = resolveRefName(propSchema.$ref);
      const refSchema = (components.schemas || {})[refName] || {};
      if (!isObjectSchema(refSchema)) {
        return { name, javaType: openApiTypeToJava(refSchema) };
      }
      nestedDtoNames.add(refName);
      return { name, javaType: refName + 'Dto' };
    }
    if (propSchema.type === 'array' && propSchema.items) {
      if (propSchema.items.$ref) {
        const refName = resolveRefName(propSchema.items.$ref);
        const refSchema = (components.schemas || {})[refName] || {};
        if (!isObjectSchema(refSchema)) {
          return { name, javaType: `List<${openApiTypeToJava(refSchema)}>` };
        }
        nestedDtoNames.add(refName);
        return { name, javaType: `List<${refName}Dto>` };
      }
      return { name, javaType: openApiTypeToJava(propSchema) };
    }
    return { name, javaType: openApiTypeToJava(propSchema) };
  });
}

// ─── VO detection ─────────────────────────────────────────────────────────────

/**
 * Checks if a schema name matches a value object in the consuming BC.
 * e.g. "Money" schema in catalog-internal-api matches Money VO in orders.
 */
function findMatchingVo(schemaName, bcValueObjects) {
  return (bcValueObjects || []).find((vo) => vo.name === schemaName) || null;
}

// ─── Domain model field builder ───────────────────────────────────────────────

/**
 * Builds the domain model fields for a response schema.
 * If a nested schema matches a local VO, uses the VO type directly.
 * Returns: { fields: [{name, javaType}], voImports: string[], nestedSchemas: Map }
 */
function buildDomainModelFields(schema, components, bcYaml, packageName, moduleName) {
  const resolved = resolveSchema(schema, components);
  const properties = resolved.properties || {};
  const fields = [];
  const voImports = new Set();
  const nestedSchemaNames = new Map(); // schemaName → domainType (for nested domain models)

  for (const [name, propSchema] of Object.entries(properties)) {
    if (propSchema.$ref) {
      const refName = resolveRefName(propSchema.$ref);
      const refSchema = (components.schemas || {})[refName] || {};
      if (!isObjectSchema(refSchema)) {
        fields.push({ name, javaType: openApiTypeToJava(refSchema), isVo: false });
        continue;
      }
      const matchingVo = findMatchingVo(refName, bcYaml.valueObjects);
      if (matchingVo) {
        // Re-use the existing VO from the consuming BC
        const voImport = `${packageName}.${moduleName}.domain.valueobject.${refName}`;
        voImports.add(voImport);
        fields.push({ name, javaType: refName, isVo: true, voName: refName });
      } else {
        // Nested domain model record (will be generated as its own file)
        nestedSchemaNames.set(refName, toPascalCase(refName));
        fields.push({ name, javaType: toPascalCase(refName), isVo: false, isNested: true, infraDtoType: `${refName}Dto` });
      }
    } else if (propSchema.type === 'array' && propSchema.items) {
      if (propSchema.items.$ref) {
        const refName = resolveRefName(propSchema.items.$ref);
        const refSchema = (components.schemas || {})[refName] || {};
        if (!isObjectSchema(refSchema)) {
          fields.push({ name, javaType: `List<${openApiTypeToJava(refSchema)}>`, isVo: false });
          continue;
        }
        const matchingVo = findMatchingVo(refName, bcYaml.valueObjects);
        if (matchingVo) {
          const voImport = `${packageName}.${moduleName}.domain.valueobject.${refName}`;
          voImports.add(voImport);
          fields.push({ name, javaType: `List<${refName}>`, isVo: false });
        } else {
          nestedSchemaNames.set(refName, toPascalCase(refName));
          fields.push({ name, javaType: `List<${toPascalCase(refName)}>`, isVo: false, isNested: true, isNestedList: true, infraDtoType: `${refName}Dto`, nestedType: toPascalCase(refName) });
        }
      } else {
        // Array of scalars
        fields.push({ name, javaType: openApiTypeToJava(propSchema), isVo: false });
      }
    } else {
      fields.push({ name, javaType: openApiTypeToJava(propSchema), isVo: false });
    }
  }

  return { fields, voImports: [...voImports], nestedSchemaNames };
}

// ─── ACL mapper field expression builder ─────────────────────────────────────

/**
 * Builds mapping expressions for the ACL mapper: infra DTO field → domain model field.
 * For VO fields (Money), generates the VO constructor call.
 * For plain fields, generates dto.field().
 */
function buildMappingFields(domainFields, infraFields, voSchemas, bcYaml, packageName, moduleName) {
  return domainFields.map((domainField) => {
    if (domainField.isVo && domainField.voName) {
      const vo = (bcYaml.valueObjects || []).find((v) => v.name === domainField.voName);
      if (vo && vo.name === 'Money') {
        // Money VO: amount is Decimal (BigDecimal), currency is String
        // Wire format: amount as string, currency as string
        return {
          name: domainField.name,
          expression: `new Money(new java.math.BigDecimal(dto.${domainField.name}().amount()), dto.${domainField.name}().currency())`,
        };
      }
      // Generic VO: try to map field-by-field
      const voArgs = (vo.properties || []).map((p) => `dto.${domainField.name}().${p.name}()`).join(', ');
      return {
        name: domainField.name,
        expression: `new ${domainField.voName}(${voArgs})`,
      };
    }
    if (!domainField.isVo && domainField.isNested) {
      if (domainField.isNestedList) {
        // List of nested domain models: stream + map through private helper method
        return {
          name: domainField.name,
          expression: `dto.${domainField.name}() == null ? null : dto.${domainField.name}().stream().map(this::mapTo${domainField.nestedType}).collect(java.util.stream.Collectors.toList())`,
        };
      }
      // Direct nested domain model: delegate to private helper method
      return {
        name: domainField.name,
        expression: `mapTo${domainField.javaType}(dto.${domainField.name}())`,
      };
    }
    return { name: domainField.name, expression: `dto.${domainField.name}()` };
  });
}

// ─── Path variable extractor ──────────────────────────────────────────────────

function extractPathVariables(httpPath) {
  const matches = httpPath.match(/\{([^}]+)\}/g) || [];
  return matches.map((m) => m.slice(1, -1));
}

// ─── Operations builder ───────────────────────────────────────────────────────

/**
 * Parses all paths in the internal-api OpenAPI doc and builds a normalized
 * operations list for template rendering.
 */
function buildOperations(internalApiDoc, bcYaml, targetBc, packageName, moduleName) {
  const components = internalApiDoc.components || {};
  const operations = [];
  const allInfraDtos = []; // { dtoName, fields, nestedDtoImports, targetBcPackage }
  const allDomainModels = []; // { name, fields, voImports, aclMapperClassName, targetBcPackage }
  const processedSchemas = new Set();
  const allNestedMappings = []; // { domainType, infraDtoName, mappingFields }
  const processedNestedDomainModels = new Set();

  const targetBcPackage = toCamelCase(targetBc);
  const aclMapperClassName = `${toPascalCase(targetBc)}AclMapper`;

  for (const [httpPath, pathItem] of Object.entries(internalApiDoc.paths || {})) {
    for (const httpVerb of ['get', 'post', 'put', 'patch', 'delete']) {
      const opSpec = pathItem[httpVerb];
      if (!opSpec) continue;

      const operationId = opSpec.operationId || `${httpVerb}${toPascalCase(httpPath.replace(/[{}\/]/g, '_'))}`;
      const pathVariables = extractPathVariables(httpPath);
      const description = (opSpec.summary || opSpec.description || operationId).replace(/\n/g, ' ').trim();

      // Query parameters (in: query) — supports both inline and $ref parameters
      const queryParams = (opSpec.parameters || [])
        .map((p) => (p.$ref ? (components.parameters || {})[resolveRefName(p.$ref)] : p))
        .filter((p) => p && p.in === 'query')
        .map((p) => ({ name: p.name, javaType: openApiTypeToJava(p.schema || {}) }));

      // Request body schema → infra request DTO
      let requestDtoName = null;
      const reqBodySchema = opSpec.requestBody?.content?.['application/json']?.schema;
      if (reqBodySchema && ['post', 'put', 'patch'].includes(httpVerb)) {
        const reqRefName = reqBodySchema.$ref ? resolveRefName(reqBodySchema.$ref) : null;
        if (reqRefName) {
          requestDtoName = `${reqRefName}Dto`;
          if (!processedSchemas.has(`req:${reqRefName}`)) {
            processedSchemas.add(`req:${reqRefName}`);
            const reqSchema = (components.schemas || {})[reqRefName] || {};
            const reqNestedNames = new Set();
            const reqFields = schemaToFields(reqSchema, components, reqNestedNames);
            const reqNestedImports = [...reqNestedNames].map(
              (n) => `${packageName}.${moduleName}.infrastructure.adapters.${targetBcPackage}.dtos.${n}Dto`
            );
            allInfraDtos.push({
              dtoName: requestDtoName,
              fields: reqFields,
              nestedDtoImports: reqNestedImports,
              targetBcPackage,
              targetBc,
            });
            // Generate nested DTOs from request body recursively (any nesting depth)
            const reqNestedQueue = [...reqNestedNames];
            while (reqNestedQueue.length > 0) {
              const nestedName = reqNestedQueue.shift();
              if (processedSchemas.has(nestedName)) continue;
              processedSchemas.add(nestedName);
              const nestedSchema = (components.schemas || {})[nestedName] || {};
              const grandchildNames = new Set();
              const nestedFields = schemaToFields(nestedSchema, components, grandchildNames);
              const gcImports = [...grandchildNames].map(
                (n) => `${packageName}.${moduleName}.infrastructure.adapters.${targetBcPackage}.dtos.${n}Dto`
              );
              allInfraDtos.push({
                dtoName: `${nestedName}Dto`,
                fields: nestedFields,
                nestedDtoImports: gcImports,
                targetBcPackage,
                targetBc,
              });
              for (const gc of grandchildNames) reqNestedQueue.push(gc);
            }
          }
        }
      }

      // Response schema
      let infraDtoName = null;
      let domainType = null;
      let hasDomainReturn = false;
      let infraDtoFields = [];
      const nestedDtoImports = [];

      const response200 = opSpec.responses?.['200'];
      const responseSchema = response200?.content?.['application/json']?.schema;

      if (responseSchema) {
        hasDomainReturn = true;
        // Handle top-level array response (type:array + items.$ref)
        let isTopLevelList = false;
        let refName = null;
        if (responseSchema.$ref) {
          refName = resolveRefName(responseSchema.$ref);
        } else if (responseSchema.type === 'array' && responseSchema.items?.$ref) {
          refName = resolveRefName(responseSchema.items.$ref);
          isTopLevelList = true;
        }

        if (refName && !processedSchemas.has(refName)) {
          processedSchemas.add(refName);
          infraDtoName = `${refName}Dto`;
          domainType = toPascalCase(refName.replace(/Response$/, ''));

          // Build infra DTO fields
          const nestedDtoNames = new Set();
          const infraSchema = (components.schemas || {})[refName] || {};
          infraDtoFields = schemaToFields(infraSchema, components, nestedDtoNames);

          // Process nested DTOs recursively (handles any nesting depth, e.g. Money inside ProductPriceValidationItem)
          const nestedQueue = [...nestedDtoNames];
          while (nestedQueue.length > 0) {
            const nestedName = nestedQueue.shift();
            const nestedDtoName = `${nestedName}Dto`;

            // Only add import to parent DTO if this is a direct child
            if (nestedDtoNames.has(nestedName)) {
              nestedDtoImports.push(
                `${packageName}.${moduleName}.infrastructure.adapters.${targetBcPackage}.dtos.${nestedDtoName}`
              );
            }

            if (!processedSchemas.has(nestedName)) {
              processedSchemas.add(nestedName);
              const nestedSchema = (components.schemas || {})[nestedName] || {};
              const grandchildNames = new Set();
              const nestedFields = schemaToFields(nestedSchema, components, grandchildNames);
              const gcImports = [...grandchildNames].map(
                (n) => `${packageName}.${moduleName}.infrastructure.adapters.${targetBcPackage}.dtos.${n}Dto`
              );
              allInfraDtos.push({
                dtoName: nestedDtoName,
                fields: nestedFields,
                nestedDtoImports: gcImports,
                targetBcPackage,
                targetBc,
              });
              for (const gc of grandchildNames) nestedQueue.push(gc);
            }
          }

          // Infra DTO for the main response
          allInfraDtos.push({
            dtoName: infraDtoName,
            fields: infraDtoFields,
            nestedDtoImports,
            targetBcPackage,
            targetBc,
          });

          // Domain model fields (with VO detection)
          const { fields: domainFields, voImports, nestedSchemaNames } = buildDomainModelFields(
            (components.schemas || {})[refName] || {},
            components,
            bcYaml,
            packageName,
            moduleName
          );

          // Mapping expressions for ACL mapper
          const mappingFields = buildMappingFields(
            domainFields,
            infraDtoFields,
            components.schemas || {},
            bcYaml,
            packageName,
            moduleName
          );

          const needsBigDecimal = mappingFields.some((f) => f.expression && f.expression.includes('BigDecimal'));

          allDomainModels.push({
            name: domainType,
            fields: domainFields,
            voImports,
            aclMapperClassName,
            targetBcPackage,
            targetBc,
          });

          // Generate nested domain models (non-VO $ref fields and array element types)
          for (const [nestedRefName, nestedDomainType] of nestedSchemaNames) {
            if (processedNestedDomainModels.has(nestedRefName)) continue;
            processedNestedDomainModels.add(nestedRefName);
            const nestedSchema = (components.schemas || {})[nestedRefName] || {};
            const { fields: nestedDomainFields, voImports: nestedVoImports } = buildDomainModelFields(
              nestedSchema, components, bcYaml, packageName, moduleName
            );
            const nestedMappingFields = buildMappingFields(
              nestedDomainFields, [], components.schemas || {}, bcYaml, packageName, moduleName
            );
            allDomainModels.push({
              name: nestedDomainType,
              fields: nestedDomainFields,
              voImports: nestedVoImports,
              aclMapperClassName,
              targetBcPackage,
              targetBc,
            });
            allNestedMappings.push({
              domainType: nestedDomainType,
              infraDtoName: `${nestedRefName}Dto`,
              mappingFields: nestedMappingFields,
            });
          }

          operations.push({
            methodName: toCamelCase(operationId),
            feignMethodName: toCamelCase(operationId),
            description,
            httpVerb: httpVerb.toUpperCase(),
            httpPath,
            pathVariables,
            queryParams,
            hasBody: ['post', 'put', 'patch'].includes(httpVerb),
            hasResponse: true,
            hasDomainReturn,
            infraDtoName,
            domainType,
            returnList: isTopLevelList,
            requestDtoName,
            infraDtoFields,
            mappingFields,
            needsBigDecimal,
          });
        } else if (refName) {
          // Already processed schema — reuse names
          infraDtoName = `${refName}Dto`;
          domainType = toPascalCase(refName.replace(/Response$/, ''));

          const { fields: domainFields } = buildDomainModelFields(
            (components.schemas || {})[refName] || {},
            components,
            bcYaml,
            packageName,
            moduleName
          );
          const mappingFields = buildMappingFields(
            domainFields,
            [],
            components.schemas || {},
            bcYaml,
            packageName,
            moduleName
          );
          const needsBigDecimal = mappingFields.some((f) => f.expression && f.expression.includes('BigDecimal'));

          operations.push({
            methodName: toCamelCase(operationId),
            feignMethodName: toCamelCase(operationId),
            description,
            httpVerb: httpVerb.toUpperCase(),
            httpPath,
            pathVariables,
            queryParams,
            hasBody: ['post', 'put', 'patch'].includes(httpVerb),
            hasResponse: true,
            hasDomainReturn: true,
            infraDtoName,
            domainType,
            returnList: isTopLevelList,
            requestDtoName,
            infraDtoFields,
            mappingFields,
            needsBigDecimal,
          });
        }
      } else {
        // No response body
        operations.push({
          methodName: toCamelCase(operationId),
          feignMethodName: toCamelCase(operationId),
          description,
          httpVerb: httpVerb.toUpperCase(),
          httpPath,
          pathVariables,
          queryParams,
          hasBody: ['post', 'put', 'patch'].includes(httpVerb),
          hasResponse: false,
          hasDomainReturn: false,
          infraDtoName: null,
          domainType: null,
          returnList: false,
          requestDtoName,
          infraDtoFields: [],
          mappingFields: [],
          needsBigDecimal: false,
        });
      }
    }
  }

  return { operations, allInfraDtos, allDomainModels, allNestedMappings };
}

// ─── FK method collector ──────────────────────────────────────────────────────

/**
 * Collects FK validation methods that reference the target BC.
 * These become methods on the unified port interface.
 */
function collectFkMethods(bcYaml, targetBc) {
  const seen = new Set();
  const fkMethods = [];

  for (const uc of bcYaml.useCases || []) {
    for (const fk of uc.fkValidations || []) {
      if (fk.bc !== targetBc) continue;
      const methodName = `exists${fk.aggregate}`;
      if (seen.has(methodName)) continue;
      seen.add(methodName);
      fkMethods.push({
        aggregate: fk.aggregate,
        methodName,
      });
    }
  }

  return fkMethods;
}

// ─── ACL mapper VO import collector ──────────────────────────────────────────

function collectAclMapperVoImports(operations, packageName, moduleName) {
  const imports = new Set();
  const needsBigDecimal = operations.some((op) =>
    op.mappingFields && op.mappingFields.some((f) => f.expression && f.expression.includes('BigDecimal'))
  );
  for (const op of operations) {
    if (!op.hasDomainReturn) continue;
    if (!op.mappingFields) continue;
    for (const mf of op.mappingFields) {
      if (mf.expression && mf.expression.startsWith('new Money')) {
        imports.add(`${packageName}.${moduleName}.domain.valueobject.Money`);
      }
    }
  }
  return { voImports: [...imports], needsBigDecimal };
}

// ─── Main generator ───────────────────────────────────────────────────────────

async function generateOutboundHttpAdapters(bcYaml, config, outputDir, system = {}) {
  const { packageName } = config;
  const moduleName = bcYaml.bc;
  const packagePath = toPackagePath(packageName);
  const bcDir = path.join(outputDir, 'src', 'main', 'java', packagePath, moduleName);

  const outboundIntegrations = (bcYaml.integrations?.outbound || []).filter(
    (integration) => integration.protocol === 'http'
  );

  if (outboundIntegrations.length === 0) return;

  for (const integration of outboundIntegrations) {
    const targetBc = integration.name;
    const targetBcPackage = toCamelCase(targetBc);
    const targetBcPascal = toPascalCase(targetBc);

    // Load the target BC's internal API
    let internalApiDoc;
    try {
      internalApiDoc = await readInternalApiYaml(targetBc);
    } catch (err) {
      logger.warn(`Skipping outbound HTTP adapter for ${moduleName} → ${targetBc}: ${err.message}`);
      continue;
    }

    if (!internalApiDoc) {
      logger.warn(
        `No internal API found for BC "${targetBc}" (arch/${targetBc}/${targetBc}-internal-api.yaml). ` +
          `Skipping outbound HTTP adapter generation for ${moduleName} → ${targetBc}.`
      );
      continue;
    }

    // Naming
    const portInterfaceName = `${targetBcPascal}ServicePort`;
    const feignClientClassName = `${targetBcPascal}FeignClient`;
    const feignConfigClassName = `${targetBcPascal}FeignConfig`;
    const feignAdapterClassName = `${targetBcPascal}FeignAdapter`;
    const aclMapperClassName = `${targetBcPascal}AclMapper`;
    // Incluye el BC origen (moduleName) para garantizar unicidad del bean Feign
    // cuando varios BCs consumen el mismo BC destino: dos `@FeignClient(name=...)`
    // con el mismo nombre rompen el arranque de Spring ("bean name already defined").
    const feignClientName = `${moduleName}-${targetBc}-service`;
    const baseUrlProperty = `integration.${targetBc}.base-url`;

    // Parse operations from the internal API
    const { operations, allInfraDtos, allDomainModels, allNestedMappings } = buildOperations(
      internalApiDoc,
      bcYaml,
      targetBc,
      packageName,
      moduleName
    );

    // Collect FK methods
    const fkMethods = collectFkMethods(bcYaml, targetBc);

    // ACL mapper VO imports — aggregate from all domain models (top-level + nested)
    const voImportsSet = new Set();
    for (const dm of allDomainModels) {
      for (const imp of (dm.voImports || [])) voImportsSet.add(imp);
    }
    const voImports = [...voImportsSet];
    const needsBigDecimal =
      operations.some((op) => op.mappingFields?.some((f) => f.expression?.includes('BigDecimal'))) ||
      allNestedMappings.some((nm) => nm.mappingFields?.some((f) => f.expression?.includes('BigDecimal')));

    // Output directories
    const portsDir = path.join(bcDir, 'application', 'ports');
    const domainModelsDir = path.join(bcDir, 'domain', 'models', targetBcPackage);
    const adapterDir = path.join(bcDir, 'infrastructure', 'adapters', targetBcPackage);
    const adapterDtosDir = path.join(adapterDir, 'dtos');

    // Phase 5 — resilience + auth resolution (optional; both can be null)
    const resilience = resolveResilienceForBcHttp(system, bcYaml, targetBc);
    const auth       = resolveAuthForBcHttp(system, bcYaml, targetBc);

    const templateVarsBase = {
      packageName,
      moduleName,
      targetBc,
      targetBcPackage,
      portInterfaceName,
      feignClientClassName,
      feignConfigClassName,
      feignAdapterClassName,
      aclMapperClassName,
      feignClientName,
      baseUrlProperty,
      operations,
      fkMethods,
      resilience,
      auth,
    };

    // 1. Port interface (application/ports/)
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'OutboundPortInterface.java.ejs'),
      path.join(portsDir, `${portInterfaceName}.java`),
      { ...templateVarsBase, domainModels: allDomainModels }
    );

    // 2. Domain model records (domain/models/{targetBcPackage}/)
    for (const dm of allDomainModels) {
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'OutboundDomainModel.java.ejs'),
        path.join(domainModelsDir, `${dm.name}.java`),
        {
          ...dm,
          packageName,
          moduleName,
        }
      );
    }

    // 3. Infrastructure response DTOs (infrastructure/adapters/{targetBcPackage}/dtos/)
    for (const dto of allInfraDtos) {
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'OutboundResponseDto.java.ejs'),
        path.join(adapterDtosDir, `${dto.dtoName}.java`),
        {
          ...dto,
          packageName,
          moduleName,
        }
      );
    }

    // 4. Feign client interface (infrastructure/adapters/{targetBcPackage}/)
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'OutboundFeignClient.java.ejs'),
      path.join(adapterDir, `${feignClientClassName}.java`),
      templateVarsBase
    );

    // 5. Feign configuration (infrastructure/adapters/{targetBcPackage}/)
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'OutboundFeignConfig.java.ejs'),
      path.join(adapterDir, `${feignConfigClassName}.java`),
      { ...templateVarsBase, targetBc }
    );

    // 6. Feign adapter — implements the port (infrastructure/adapters/{targetBcPackage}/)
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'OutboundFeignAdapter.java.ejs'),
      path.join(adapterDir, `${feignAdapterClassName}.java`),
      templateVarsBase
    );

    // 7. ACL mapper (infrastructure/adapters/{targetBcPackage}/)
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'OutboundAclMapper.java.ejs'),
      path.join(adapterDir, `${aclMapperClassName}.java`),
      { ...templateVarsBase, voImports, needsBigDecimal, nestedMappings: allNestedMappings }
    );
  }
}

/**
 * Returns a Set of BC names that have outbound HTTP integrations declared in this BC's YAML.
 * Used by application-generator.js to avoid emitting duplicate ServicePort files.
 */
function getOutboundHttpBcNames(bcYaml) {
  return new Set(
    (bcYaml.integrations?.outbound || [])
      .filter((i) => i.protocol === 'http')
      .map((i) => i.name)
  );
}

module.exports = { generateOutboundHttpAdapters, getOutboundHttpBcNames };
