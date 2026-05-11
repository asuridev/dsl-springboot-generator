'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPascalCase, toCamelCase, toPackagePath } = require('../utils/naming');
const { derivedFrom } = require('../utils/derived-from');
const { resolveResilienceForExternal, resolveAuthForExternal } = require('../utils/resilience-auth-resolver');
const logger = require('../utils/logger');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates', 'infrastructure', 'adapters');
const EXT_TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates', 'infrastructure', 'adapters', 'external');

// ─── Wire-format type mapping for external APIs ──────────────────────────────
//
// External APIs declare types in `externalSystems[].operations[].request|response.fields[].type`.
// Scalar wire-format types are mapped directly. Types that match a key in the `schemas` map
// of the same externalSystem entry are resolved to `{SchemaName}Dto`.
// The OpenAPI-style List<X> convention is supported at any level (e.g. List<SplitDetail>).
// Anything richer in the domain model must be declared in domain.fields[].
//
function mapWireType(type, schemas = {}) {
  if (!type) return 'Object';
  // OpenAPI-style List<X> convention — resolved recursively
  const listMatch = type.match(/^List<(.+)>$/);
  if (listMatch) {
    const inner = mapWireType(listMatch[1], schemas);
    return `List<${inner}>`;
  }
  switch (type) {
    case 'String':  return 'String';
    case 'Integer': return 'Integer';
    case 'Long':    return 'Long';
    case 'Boolean': return 'Boolean';
    case 'Decimal': return 'BigDecimal';
    case 'Instant': return 'Instant';
    case 'UUID':    return 'String'; // wire-format: keep as string
    default:
      // Schema reference declared in externalSystems[].schemas → XDto
      return schemas[type] ? `${type}Dto` : 'Object';
  }
}

function mapDomainType(type) {
  if (!type) return 'Object';
  // OpenAPI-style List<X> convention — resolved recursively
  const listMatch = type.match(/^List<(.+)>$/);
  if (listMatch) {
    const inner = mapDomainType(listMatch[1]);
    return `List<${inner}>`;
  }
  switch (type) {
    case 'String':  return 'String';
    case 'Integer': return 'Integer';
    case 'Long':    return 'Long';
    case 'Boolean': return 'boolean';
    case 'Decimal': return 'BigDecimal';
    case 'Instant': return 'Instant';
    case 'UUID':    return 'java.util.UUID';
    default: return type; // domain VO/record name
  }
}

function fieldsToJava(fields, schemas = {}) {
  return (fields || []).map((f) => ({
    name: f.name,
    javaType: mapWireType(f.type, schemas),
    optional: !!f.optional,
  }));
}

// ─── Nested DTO import extractor ─────────────────────────────────────────────
//
// Scans a resolved javaFields array for any XDto tokens and builds the list
// of fully-qualified imports so that operation DTOs can reference schema DTOs.
//
function extractNestedDtoImports(javaFields, packageName, moduleName, targetBcPackage) {
  const imports = [];
  const seen = new Set();
  for (const f of javaFields) {
    // Match every XDto token inside the javaType (handles List<XDto>, XDto, etc.)
    const matches = [...(f.javaType || '').matchAll(/\b(\w+Dto)\b/g)];
    for (const [, dtoName] of matches) {
      if (!seen.has(dtoName)) {
        seen.add(dtoName);
        imports.push(
          `${packageName}.${moduleName}.infrastructure.adapters.${targetBcPackage}.dtos.${dtoName}`
        );
      }
    }
  }
  return imports;
}

function domainFieldsToJava(fields) {
  return (fields || []).map((f) => ({
    name: f.name,
    javaType: mapDomainType(f.type),
    source: f.source || null,
    derivedFromExpr: f.derivedFrom || null,
  }));
}

// ─── Path-variable extractor ─────────────────────────────────────────────────

function extractPathVariables(httpPath) {
  const matches = httpPath.match(/\{([^}]+)\}/g) || [];
  return matches.map((m) => m.slice(1, -1));
}

// ─── Per-operation builder ───────────────────────────────────────────────────

function buildOperation(extName, opSpec, packageName, moduleName, targetBcPackage, extSchemas = {}) {
  const opName = opSpec.name;
  const httpVerb = (opSpec.method || 'GET').toUpperCase();
  const httpPath = opSpec.path || `/${opName}`;
  const pathVariables = extractPathVariables(httpPath);

  const hasBody = ['POST', 'PUT', 'PATCH'].includes(httpVerb) && opSpec.request && opSpec.request.fields;
  const hasResponse = !!(opSpec.response && opSpec.response.fields);
  const hasDomainReturn = hasResponse && !!(opSpec.domain && opSpec.domain.returnType);

  const requestDtoName = hasBody ? `${toPascalCase(opName)}RequestDto` : null;
  const requestFields = hasBody ? fieldsToJava(opSpec.request.fields, extSchemas) : [];

  const infraDtoName = hasResponse ? `${toPascalCase(opName)}ResponseDto` : null;
  const infraDtoFields = hasResponse ? fieldsToJava(opSpec.response.fields, extSchemas) : [];

  const domainType = hasDomainReturn ? toPascalCase(opSpec.domain.returnType) : null;
  const domainFields = hasDomainReturn ? domainFieldsToJava(opSpec.domain.fields) : [];

  const yamlPointer = `system.yaml#/externalSystems/${extName}/operations/${opName}`;

  return {
    methodName: toCamelCase(opName),
    feignMethodName: toCamelCase(opName),
    description: (opSpec.description || opName).replace(/\n/g, ' ').trim(),
    httpVerb,
    httpPath,
    pathVariables,
    hasBody,
    hasResponse,
    hasDomainReturn,
    returnList: false,
    infraDtoName,
    infraDtoFields,
    requestDtoName,
    requestFields,
    domainType,
    domainFields,
    yamlPointer,
    // Used by reusable OutboundFeignClient/Adapter templates:
    mappingFields: [], // mapper body is // TODO for externals; templates won't render expressions
  };
}

// ─── Single-external generation ──────────────────────────────────────────────

async function generateForExternal(bcYaml, ext, config, outputDir, system = {}) {
  const { packageName } = config;
  const moduleName = bcYaml.bc;
  const packagePath = toPackagePath(packageName);
  const bcDir = path.join(outputDir, 'src', 'main', 'java', packagePath, moduleName);

  const extName = ext.name;
  const targetBcPackage = toCamelCase(extName);
  const targetBcPascal = toPascalCase(extName);

  // Naming
  const portInterfaceName = `${targetBcPascal}ClientPort`;
  const feignClientClassName = `${targetBcPascal}RestClient`;
  const feignConfigClassName = `${targetBcPascal}RestConfig`;
  const feignAdapterClassName = `${targetBcPascal}AclAdapter`;
  const aclMapperClassName = `${targetBcPascal}AclMapper`;
  const feignClientName = `${extName}-client`;
  const baseUrlProperty = ext.baseUrlProperty || `integration.${extName}.base-url`;

  const extSchemas = ext.schemas || {};

  const operations = (ext.operations || []).map((op) =>
    buildOperation(extName, op, packageName, moduleName, targetBcPackage, extSchemas)
  );

  if (operations.length === 0) return 0;

  // Output dirs
  const portsDir = path.join(bcDir, 'application', 'ports');
  const domainModelsDir = path.join(bcDir, 'domain', 'models', targetBcPackage);
  const adapterDir = path.join(bcDir, 'infrastructure', 'adapters', targetBcPackage);
  const adapterDtosDir = path.join(adapterDir, 'dtos');

  // Build allInfraDtos:
  //   1. Schema DTOs (declared in ext.schemas) — must come first so that operation
  //      DTOs can reference them via nestedDtoImports without forward-reference issues.
  //   2. Operation request/response DTOs — may reference schema DTOs.
  const allInfraDtos = [];

  // 1. Schema DTOs
  for (const [schemaName, schemaFields] of Object.entries(extSchemas)) {
    const javaFields = fieldsToJava(schemaFields, extSchemas);
    allInfraDtos.push({
      dtoName: `${schemaName}Dto`,
      fields: javaFields,
      nestedDtoImports: extractNestedDtoImports(javaFields, packageName, moduleName, targetBcPackage),
      targetBcPackage,
      targetBc: extName,
      packageName,
      moduleName,
      derivedFromComment: derivedFrom(`system.yaml#/externalSystems/${extName}/schemas/${schemaName}`),
    });
  }

  // 2. Operation request/response DTOs
  for (const op of operations) {
    if (op.requestDtoName) {
      allInfraDtos.push({
        dtoName: op.requestDtoName,
        fields: op.requestFields,
        nestedDtoImports: extractNestedDtoImports(op.requestFields, packageName, moduleName, targetBcPackage),
        targetBcPackage,
        targetBc: extName,
        packageName,
        moduleName,
        derivedFromComment: derivedFrom(`${op.yamlPointer}/request`),
      });
    }
    if (op.infraDtoName) {
      allInfraDtos.push({
        dtoName: op.infraDtoName,
        fields: op.infraDtoFields,
        nestedDtoImports: extractNestedDtoImports(op.infraDtoFields, packageName, moduleName, targetBcPackage),
        targetBcPackage,
        targetBc: extName,
        packageName,
        moduleName,
        derivedFromComment: derivedFrom(`${op.yamlPointer}/response`),
      });
    }
  }

  // Domain model records (one per unique domainType)
  const seenDomain = new Set();
  const allDomainModels = [];
  for (const op of operations) {
    if (!op.domainType || seenDomain.has(op.domainType)) continue;
    seenDomain.add(op.domainType);
    allDomainModels.push({
      name: op.domainType,
      fields: op.domainFields.map((f) => ({
        name: f.name,
        javaType: f.javaType,
        derivedFromComment: f.derivedFromExpr ? `// derived_from: ${f.derivedFromExpr}` : (f.source ? `// source: dto.${f.source}` : ''),
      })),
      voImports: [],
      aclMapperClassName,
      targetBcPackage,
      targetBc: extName,
      packageName,
      moduleName,
      derivedFromComment: derivedFrom(`${op.yamlPointer}/domain`),
    });
  }

  // Domain models for reusable template (without trace comments per field)
  const allDomainModelsForPort = allDomainModels.map((dm) => ({
    name: dm.name,
    fields: dm.fields.map((f) => ({ name: f.name, javaType: f.javaType })),
  }));

  const templateVarsBase = {
    packageName,
    moduleName,
    targetBc: extName,
    targetBcPackage,
    portInterfaceName,
    feignClientClassName,
    feignConfigClassName,
    feignAdapterClassName,
    aclMapperClassName,
    feignClientName,
    baseUrlProperty,
    operations,
    fkMethods: [], // externals never have FK validations
    auth: resolveAuthForExternal(system, bcYaml, extName),
    resilience: resolveResilienceForExternal(system, bcYaml, extName),
    derivedFromComment: derivedFrom(`system.yaml#/externalSystems/${extName}`),
  };

  // 1. Port interface (reuse OutboundPortInterface — supports fkMethods=[])
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'OutboundPortInterface.java.ejs'),
    path.join(portsDir, `${portInterfaceName}.java`),
    { ...templateVarsBase, domainModels: allDomainModelsForPort }
  );

  // 2. Domain model records (custom template emits derived_from per field)
  for (const dm of allDomainModels) {
    await renderAndWrite(
      path.join(EXT_TEMPLATES_DIR, 'ExternalDomainModel.java.ejs'),
      path.join(domainModelsDir, `${dm.name}.java`),
      dm
    );
  }

  // 3. Request + response DTOs (custom template emits derived_from header)
  for (const dto of allInfraDtos) {
    await renderAndWrite(
      path.join(EXT_TEMPLATES_DIR, 'ExternalDto.java.ejs'),
      path.join(adapterDtosDir, `${dto.dtoName}.java`),
      dto
    );
  }

  // 4. Rest client (@FeignClient interface) — reuse OutboundFeignClient
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'OutboundFeignClient.java.ejs'),
    path.join(adapterDir, `${feignClientClassName}.java`),
    templateVarsBase
  );

  // 5. Rest config (custom — adds auth header placeholder if declared)
  await renderAndWrite(
    path.join(EXT_TEMPLATES_DIR, 'ExternalRestConfig.java.ejs'),
    path.join(adapterDir, `${feignConfigClassName}.java`),
    templateVarsBase
  );

  // 6. ACL adapter (reuse OutboundFeignAdapter — fkMethods=[] omits FK section)
  await renderAndWrite(
    path.join(TEMPLATES_DIR, 'OutboundFeignAdapter.java.ejs'),
    path.join(adapterDir, `${feignAdapterClassName}.java`),
    templateVarsBase
  );

  // 7. ACL mapper (custom — emits // TODO bodies with derived_from comments)
  await renderAndWrite(
    path.join(EXT_TEMPLATES_DIR, 'ExternalAclMapper.java.ejs'),
    path.join(adapterDir, `${aclMapperClassName}.java`),
    templateVarsBase
  );

  return operations.length;
}

// ─── Public API ──────────────────────────────────────────────────────────────

async function generateExternalAdapters(allBcYamls, system, config, outputDir, options = {}) {
  const strict = options.strict === true;
  const externalsByName = new Map((system.externalSystems || []).map((e) => [e.name, e]));
  if (externalsByName.size === 0) return { adapters: 0, operations: 0 };

  let adapters = 0;
  let operations = 0;

  for (const bcYaml of allBcYamls) {
    const externalOutbounds = ((bcYaml.integrations && bcYaml.integrations.outbound) || []).filter(
      (ob) => ob.type === 'externalSystem' || externalsByName.has(ob.name)
    );

    for (const ob of externalOutbounds) {
      const ext = externalsByName.get(ob.name);
      if (!ext) continue;
      if (!ext.operations || ext.operations.length === 0) {
        const message = `External system "${ext.name}" has no operations declared in system.yaml — skipping ACL adapter generation for ${bcYaml.bc} → ${ext.name}.`;
        if (strict) {
          throw new Error(`${message} Re-run with --no-strict to continue with a warning.`);
        }
        logger.info(message);
        continue;
      }

      try {
        const opCount = await generateForExternal(bcYaml, ext, config, outputDir, system);
        if (opCount > 0) {
          adapters++;
          operations += opCount;
        }
      } catch (err) {
        const message = `Skipping external ACL adapter for ${bcYaml.bc} → ${ext.name}: ${err.message}`;
        if (strict) {
          throw new Error(`${message}. Re-run with --no-strict to continue with a warning.`);
        }
        logger.warn(message);
      }
    }
  }

  return { adapters, operations };
}

module.exports = { generateExternalAdapters };
