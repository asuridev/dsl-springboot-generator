'use strict';

const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPackagePath, toCamelCase, pluralizeWord } = require('../utils/naming');
const { mapType, isListType, getListElementType } = require('../utils/type-mapper');
const { buildDomainChecks } = require('../utils/validation-mapper');
const logger = require('../utils/logger');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

// ─── Audit / SoftDelete field names that are injected, not from YAML props ───
const AUDIT_FIELDS = new Set(['createdAt', 'updatedAt']);
const SOFT_DELETE_FIELD = 'deletedAt';

// ─── Fields excluded from the creation constructor ────────────────────────────
// (in addition to readOnly fields that have a defaultValue)
const ALWAYS_EXCLUDE_FROM_CREATION = new Set(['createdAt', 'updatedAt', 'deletedAt']);

// [Phase 3, Gap E1.d] Local copy of `deriveErrorType` from
// application-generator: SCREAMING_SNAKE → PascalCase + "Error" suffix.
function deriveErrorTypeLocal(code) {
  return code
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('') + 'Error';
}

// ─── Helper: resolve Java type for a param name ───────────────────────────────
function resolveParamType(paramName, aggregateProps, childEntities, typeHint, bcYaml) {
  // 1. Explicit typeHint declared in YAML always wins — prevents aggregate property
  //    inference from overriding an intentionally declared param type (e.g. a param
  //    named "lines" with type "List[OrderLineSnapshot]" when the aggregate has a
  //    property also named "lines" with type "List[OrderLine]").
  if (typeHint) {
    // 1a. List[X] — resolve inner type then wrap in List<>
    if (isListType(typeHint)) {
      const innerRaw = getListElementType(typeHint);
      let innerJavaType;
      if (bcYaml) {
        if ((bcYaml.valueObjects || []).some((vo) => vo.name === innerRaw)) {
          innerJavaType = innerRaw;
        } else {
          const enumMatch = /^Enum<(.+)>$/.exec(innerRaw);
          const resolvedEnum = enumMatch ? enumMatch[1] : innerRaw;
          if ((bcYaml.enums || []).some((e) => e.name === resolvedEnum)) {
            innerJavaType = resolvedEnum;
          }
        }
      }
      if (!innerJavaType) {
        try {
          innerJavaType = mapType(innerRaw, {}).javaType;
        } catch (_) {
          innerJavaType = innerRaw; // pass through as domain type
        }
      }
      return `List<${innerJavaType}>`;
    }

    // 1b. Known VO or enum in the BC
    if (bcYaml) {
      if ((bcYaml.valueObjects || []).some((vo) => vo.name === typeHint)) return typeHint;
      const enumMatch = /^Enum<(.+)>$/.exec(typeHint);
      const resolvedEnum = enumMatch ? enumMatch[1] : typeHint;
      if ((bcYaml.enums || []).some((e) => e.name === resolvedEnum)) return resolvedEnum;
    }

    // 1c. Canonical / scalar type
    try {
      return mapType(typeHint, {}).javaType;
    } catch (_) {
      return typeHint; // pass through as domain type
    }
  }

  // 2. Infer from aggregate properties (fallback when no typeHint)
  const aggrProp = (aggregateProps || []).find((p) => p.name === paramName);
  if (aggrProp) {
    try {
      return mapType(aggrProp.type, aggrProp).javaType;
    } catch (_) {
      return 'Object';
    }
  }

  // 3. Infer from child entity properties
  for (const entity of childEntities || []) {
    const entProp = (entity.properties || []).find((p) => p.name === paramName);
    if (entProp) {
      try {
        return mapType(entProp.type, entProp).javaType;
      } catch (_) {
        return 'Object';
      }
    }
  }

  // 4. Heuristics by name convention
  if (paramName === 'id' || paramName.endsWith('Id')) return 'UUID';
  if (paramName.endsWith('At')) return 'Instant';
  if (paramName === 'password' || paramName === 'passwordHash') return 'String';

  return 'Object';
}

// ─── Helper: parse method signature string ────────────────────────────────────
// Input:  "create(name, description?, displayOrder?): Category"
// Input:  "removeImage(imageId: Uuid): void"  (inline type hints supported)
// Output: { name, params: [{name, optional, typeHint}], returnType }
function parseMethodSignature(sig) {
  if (!sig) return null;
  // Use a balanced-paren approach: find the outermost () then the final ': returnType'
  const firstParen = sig.indexOf('(');
  // Bare method name with no parens (e.g. "abandon", "addItem") — treat as no-arg, void
  if (firstParen === -1) return { name: sig.trim(), params: [], returnType: 'void' };
  // Walk forward to find the matching closing paren (handles nested parens like String(200))
  let depth = 0;
  let closeParen = -1;
  for (let i = firstParen; i < sig.length; i++) {
    if (sig[i] === '(') depth++;
    else if (sig[i] === ')') {
      depth--;
      if (depth === 0) { closeParen = i; break; }
    }
  }
  if (closeParen === -1) return null;
  const name = sig.substring(0, firstParen).trim();
  const paramsStr = sig.substring(firstParen + 1, closeParen);
  const returnTypeMatch = sig.substring(closeParen + 1).match(/^\s*:\s*(.+)$/);
  const returnType = returnTypeMatch ? returnTypeMatch[1].trim() : 'void';
  // Split params on commas that are NOT inside nested parens
  const rawParams = [];
  let current = '';
  let d = 0;
  for (const ch of paramsStr) {
    if (ch === '(') { d++; current += ch; }
    else if (ch === ')') { d--; current += ch; }
    else if (ch === ',' && d === 0) { rawParams.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  if (current.trim()) rawParams.push(current.trim());
  const params = rawParams
    .filter(Boolean)
    .map((p) => {
      const optional = p.includes('?');
      const clean = p.replace('?', '').trim();
      // Support inline type annotation: "paramName: TypeHint"
      const colonIdx = clean.indexOf(':');
      const paramName = colonIdx !== -1 ? clean.substring(0, colonIdx).trim() : clean;
      const typeHint = colonIdx !== -1 ? clean.substring(colonIdx + 1).trim() : null;
      return { name: paramName, optional, typeHint };
    });
  return { name, params, returnType };
}

// ─── Helper: try to detect state transition for a full-implementation UC ──────
// Returns { statusField, enumType, targetValue, emits } or null
function detectStateTransition(ucId, aggregate, bcEnums) {
  const statusFields = (aggregate.properties || []).filter((p) =>
    (bcEnums || []).some((e) => e.name === p.type)
  );
  for (const field of statusFields) {
    const enumDef = (bcEnums || []).find((e) => e.name === field.type);
    if (!enumDef) continue;
    for (const valueObj of enumDef.values || []) {
      for (const t of valueObj.transitions || []) {
        if (t && t.triggeredBy && (t.triggeredBy === ucId || t.triggeredBy.startsWith(ucId + ' '))) {
          return { statusField: field.name, enumType: field.type, targetValue: t.to, emits: t.emits || null };
        }
      }
    }
  }
  return null;
}

// ─── Helper: build raise(new XxxEvent(...)) call string ────────────────────────
// Returns the raise statement string, or null if the event is not found.
// S22: accepts a single eventName (string) or a list (string[]). When a list,
// emits one raise() per event, joined by newline + 8 spaces (consumed at the
// method body indentation level).
//
// eventConfig (Phase 1): { bcName, metadataEnabled } — when metadataEnabled,
// prepends an EventMetadata.now("<EventName>", <version>, "<bcName>") argument.
function buildRaiseCall(eventNameOrList, publishedEvents, aggregate, methodParams, eventConfig = null) {
  if (!eventNameOrList) return null;
  if (!publishedEvents || publishedEvents.length === 0) return null;

  if (Array.isArray(eventNameOrList)) {
    const calls = eventNameOrList
      .map((n) => buildRaiseCallSingle(n, publishedEvents, aggregate, methodParams, eventConfig))
      .filter(Boolean);
    if (calls.length === 0) return null;
    return calls.join('\n        ');
  }
  return buildRaiseCallSingle(eventNameOrList, publishedEvents, aggregate, methodParams, eventConfig);
}

function buildRaiseCallSingle(eventName, publishedEvents, aggregate, methodParams, eventConfig = null) {
  const event = publishedEvents.find((e) => e.name === eventName);
  if (!event) return null;

  const aggregateCamelId = aggregate.name.charAt(0).toLowerCase() + aggregate.name.slice(1) + 'Id';
  const aggregatePropNames = new Set((aggregate.properties || []).map((pr) => pr.name));
  const methodParamNames = new Set((methodParams || []).map((p) => p.name));

  // Phase 1: when metadata is enabled, the canonical fields are carried by the
  // EventMetadata record component, not by the payload. Filter them out so we
  // do not emit redundant `null` arguments for fields that no longer exist on
  // the record.
  const CANONICAL = new Set(['eventId', 'eventType', 'eventVersion', 'occurredAt', 'correlationId', 'causationId']);
  const metadataEnabled = !!(eventConfig && eventConfig.metadataEnabled);
  const payloadFields = metadataEnabled
    ? (event.payload || []).filter((p) => !CANONICAL.has(p.name))
    : (event.payload || []);

  const unresolved = [];
  const getterFor = (propName) => `this.get${propName.charAt(0).toUpperCase() + propName.slice(1)}()`;
  // Phase 3: explicit source mapping — payload[].source overrides the heuristic.
  // Supported: aggregate | param | timestamp | constant | auth-context | derived
  const resolveExplicit = (p) => {
    const src = p.source;
    if (!src) return null;
    switch (src) {
      case 'aggregate': {
        const field = p.field || p.name;
        if (!aggregatePropNames.has(field)) {
          unresolved.push(`${p.name} (source: aggregate, field: ${field} not found)`);
          return `null /* TODO domainEvent(${event.name}, ${p.name}): source=aggregate but field "${field}" not in aggregate ${aggregate.name} */`;
        }
        return field === 'id' ? 'this.getId()' : getterFor(field);
      }
      case 'param': {
        const pname = p.param || p.name;
        if (!methodParamNames.has(pname)) {
          unresolved.push(`${p.name} (source: param, param: ${pname} not found)`);
          return `null /* TODO domainEvent(${event.name}, ${p.name}): source=param but parameter "${pname}" not in method signature */`;
        }
        return pname;
      }
      case 'timestamp':
        return 'Instant.now()';
      case 'constant': {
        if (p.value === undefined || p.value === null) {
          unresolved.push(`${p.name} (source: constant, value missing)`);
          return `null /* TODO domainEvent(${event.name}, ${p.name}): source=constant but value not declared */`;
        }
        if (typeof p.value === 'string') return JSON.stringify(p.value);
        if (typeof p.value === 'number' || typeof p.value === 'boolean') return String(p.value);
        return JSON.stringify(p.value);
      }
      case 'auth-context': {
        // INT-025: source: auth-context is rejected by integration-validator before the
        // generator runs. This branch is unreachable in a valid build; guard defensively.
        unresolved.push(`${p.name} (source: auth-context — invalid in event payload, blocked by INT-025)`);
        return `null /* INVALID: domainEvent(${event.name}, ${p.name}): source=auth-context is not allowed in event payload — INT-025 should have blocked this build */`;
      }
      case 'derived': {
        const ref = p.derivedFrom || p.expression || '';
        unresolved.push(`${p.name} (source: derived${ref ? ', derivedFrom: ' + ref : ''})`);
        return `null /* TODO domainEvent(${event.name}, ${p.name}): source=derived${ref ? ', derivedFrom=' + ref : ''} — implement projection */`;
      }
      default:
        unresolved.push(`${p.name} (unknown source "${src}")`);
        return `null /* TODO domainEvent(${event.name}, ${p.name}): unknown source "${src}" */`;
    }
  };

  const args = payloadFields.map((p) => {
    const explicit = resolveExplicit(p);
    if (explicit !== null) return explicit;

    if (p.name === aggregateCamelId) return 'this.getId()';
    if (aggregatePropNames.has(p.name)) return getterFor(p.name);
    if (methodParamNames.has(p.name)) return p.name;
    if (p.type === 'DateTime' || p.type === 'Instant') return 'Instant.now()';
    // gap #19: surface unresolved mappings instead of silently emitting `null`.
    unresolved.push(p.name);
    return `null /* TODO domainEvent(${event.name}, ${p.name}): mapping not resolved — declare payload[].source or rename to match aggregate property/method param */`;
  });

  if (unresolved.length > 0) {
    logger.warn(
      `[aggregate=${aggregate.name}] Event "${event.name}" has unresolved payload field(s): ${unresolved.join(', ')}. ` +
      `Add a matching aggregate property/method param, or declare payload[].source.`
    );
  }

  // Phase 1: prepend EventMetadata.now(...) when metadata is enabled.
  if (metadataEnabled) {
    const version = event.version || 1;
    const sourceBc = eventConfig.bcName || 'unknown';
    args.unshift(`EventMetadata.now("${event.name}", ${version}, "${sourceBc}")`);
  }

  return `// derived_from: domainEvents.published.${event.name}\n        raise(new ${event.name}Event(${args.join(', ')}));`;
}

// ─── Helper: compute the body string for a business method ───────────────────
function computeMethodBody(uc, sig, aggregate, bcEnums, bcName, publishedEvents, eventConfig = null, terminalStateErrorClass = null) {
  const rules = uc.rules || [];
  // Split rule IDs into validation-style vs side-effect-style based on the
  // aggregate's domainRules catalog (S13). Side effects are scaffolded as a
  // distinct comment block to make the implementation hint explicit for Phase 3.
  const ruleById = new Map((aggregate.domainRules || []).map((r) => [r.id, r]));
  const validateRules = [];
  const sideEffectRules = [];
  for (const id of rules) {
    const r = ruleById.get(id);
    if (r && r.type === 'sideEffect') sideEffectRules.push(id);
    else validateRules.push(id);
  }
  let rulesComment = '';
  if (validateRules.length > 0) rulesComment += `\n        // Validate: ${validateRules.join(', ')}`;
  if (sideEffectRules.length > 0) rulesComment += `\n        // Side effects: ${sideEffectRules.join(', ')}`;
  const scaffoldBody = `// TODO: implement business logic — ver ${bcName}-flows.md${rulesComment}\n        throw new UnsupportedOperationException("Not implemented yet");`;

  const { name: methodName, params } = sig;

  // ── Case 0: softDelete — always deterministic, overrides scaffold ─────────
  if (methodName === 'softDelete' && aggregate.softDelete === true) {
    return 'this.deletedAt = Instant.now();';
  }

  if (uc.implementation === 'scaffold') {
    // Even on scaffold UCs, if the method is a no-arg state transition we still emit the
    // state-machine line. The Enum.transitionTo() guards terminal states (PRD-RULE-004 et al.):
    // a second invocation raises InvalidStateTransitionException automatically.
    if (params.length === 0) {
      const transition = detectStateTransition(uc.id, aggregate, bcEnums);
      if (transition) {
        let body = `// TODO: implement business logic — ver ${bcName}-flows.md${rulesComment}\n`;
        const transitionLine = `this.${transition.statusField} = this.${transition.statusField}.transitionTo(${transition.enumType}.${transition.targetValue});`;
        // [Phase 3, Gap E1.d] terminalState rule with `errorCode` → wrap the
        // generic InvalidStateTransitionException into the declared domain
        // error so callers see the precise code (e.g. PRODUCT_ALREADY_DISCONTINUED).
        if (terminalStateErrorClass) {
          body += `        try {\n            ${transitionLine}\n        } catch (InvalidStateTransitionException ex) {\n            throw new ${terminalStateErrorClass}();\n        }`;
        } else {
          body += `        ${transitionLine}`;
        }
        const emitsName = sig.emits || transition.emits;
        const raiseCall = buildRaiseCall(emitsName, publishedEvents, aggregate, params, eventConfig);
        if (raiseCall) body += `\n        ${raiseCall}`;
        return body;
      }
    }
    const raiseCall = buildRaiseCall(sig.emits, publishedEvents, aggregate, params, eventConfig);
    if (raiseCall) {
      return `// TODO: implement business logic — ver ${bcName}-flows.md${rulesComment}\n        ${raiseCall}`;
    }
    return scaffoldBody;
  }

  // ── Case 1: state transition (no params, full, enum field) ───────────────
  if (params.length === 0) {
    const transition = detectStateTransition(uc.id, aggregate, bcEnums);
    if (transition) {
      const transitionLine = `this.${transition.statusField} = this.${transition.statusField}.transitionTo(${transition.enumType}.${transition.targetValue});`;
      let body;
      if (terminalStateErrorClass) {
        body = `try {\n            ${transitionLine}\n        } catch (InvalidStateTransitionException ex) {\n            throw new ${terminalStateErrorClass}();\n        }`;
      } else {
        body = transitionLine;
      }
      const emitsName = sig.emits || transition.emits;
      const raiseCall = buildRaiseCall(emitsName, publishedEvents, aggregate, params, eventConfig);
      if (raiseCall) body += `\n        ${raiseCall}`;
      return body;
    }
    // No transition detected → scaffold
    return scaffoldBody;
  }

  // ── Case 2: child entity add (addX(...)) ──────────────────────────────────
  if (methodName.startsWith('add') && methodName.length > 3) {
    const entitySuffix =
      methodName.charAt(3).toUpperCase() + methodName.slice(4);
    // match exact or suffix (e.g. 'addImage' → 'Image' matches 'ProductImage')
    const entity = (aggregate.entities || []).find(
      (e) => e.name === entitySuffix || e.name.endsWith(entitySuffix)
    );
    if (entity) {
      // S6 — branch on cardinality for the field name + body shape
      const isOneToOne = entity.cardinality === 'oneToOne';
      const fieldName = isOneToOne
        ? toCamelCase(entity.name)
        : toCamelCase(pluralizeWord(entity.name));
      // Creation params for the child entity (same exclusion rules)
      const entityCreationParams = (entity.properties || []).filter((ep) => {
        if (ep.name === 'id') return false;
        if (ALWAYS_EXCLUDE_FROM_CREATION.has(ep.name)) return false;
        if (ep.readOnly && ep.defaultValue != null) return false;
        return true;
      });
      const ctorArgs = entityCreationParams.map((ep) => ep.name).join(', ');
      let body = isOneToOne
        ? `this.${fieldName} = new ${entity.name}(${ctorArgs});`
        : `this.${fieldName}.add(new ${entity.name}(${ctorArgs}));`;
      const raiseCall = buildRaiseCall(sig.emits, publishedEvents, aggregate, params, eventConfig);
      if (raiseCall) body += `\n        ${raiseCall}`;
      return body;
    }
  }

  // ── Case 3: child entity remove (removeX(entityId)) ───────────────────────
  if (methodName.startsWith('remove') && methodName.length > 6 && params.length === 1) {
    const entitySuffix =
      methodName.charAt(6).toUpperCase() + methodName.slice(7);
    const entity = (aggregate.entities || []).find(
      (e) => e.name === entitySuffix || e.name.endsWith(entitySuffix)
    );
    if (entity) {
      // S6 — branch on cardinality for the field name + body shape
      const isOneToOne = entity.cardinality === 'oneToOne';
      const fieldName = isOneToOne
        ? toCamelCase(entity.name)
        : toCamelCase(pluralizeWord(entity.name));
      const idParam = params[0].name;
      const varName = entity.name.charAt(0).toLowerCase() + entity.name.slice(1);
      let body = isOneToOne
        ? `if (this.${fieldName} != null && this.${fieldName}.getId().equals(${idParam})) {\n            this.${fieldName} = null;\n        }`
        : `this.${fieldName}.removeIf(${varName} -> ${varName}.getId().equals(${idParam}));`;
      const raiseCall = buildRaiseCall(sig.emits, publishedEvents, aggregate, params, eventConfig);
      if (raiseCall) body += `\n        ${raiseCall}`;
      return body;
    }
  }

  // ── Case 4: simple field update (all params map to aggregate props) ────────
  const allMatch = params.every((p) =>
    (aggregate.properties || []).some((prop) => prop.name === p.name)
  );
  if (allMatch) {
    let body = params.map((p) => `this.${p.name} = ${p.name};`).join('\n        ');
    const raiseCall = buildRaiseCall(sig.emits, publishedEvents, aggregate, params, eventConfig);
    if (raiseCall) body += `\n        ${raiseCall}`;
    return body;
  }

  // ── Fallback: scaffold ──────────────────────────────────────────
  {
    const raiseCall = buildRaiseCall(sig.emits, publishedEvents, aggregate, params, eventConfig);
    if (raiseCall) {
      return `// TODO: implement business logic — ver ${bcName}-flows.md\n        ${raiseCall}`;
    }
  }
  return scaffoldBody;
}

// ─── Helper: resolve Java return type string ──────────────────────────────────
function resolveReturnType(returnTypeStr, aggregateName) {
  if (!returnTypeStr || returnTypeStr === 'void' || returnTypeStr === 'null') return 'void';
  if (returnTypeStr === aggregateName) return aggregateName;
  // Other types pass through as-is
  return returnTypeStr;
}

// ─── Helper: check if a type is a known value object ─────────────────────────
function isValueObjectType(type, bcYaml) {
  return (bcYaml.valueObjects || []).some((vo) => vo.name === type);
}

// ─── Helper: check if a type is an enum ──────────────────────────────────────
function isEnumType(type, bcYaml) {
  return (bcYaml.enums || []).some((e) => e.name === type);
}

// ─── Helper: build imports for an aggregate class ────────────────────────────
function buildImports(aggregate, bcYaml, config, businessMethods, publishedEvents) {
  const bc = bcYaml.bc;
  const pkg = config.packageName;
  const imports = new Set();
  const metadataEnabled = !(config.events && config.events.metadata && config.events.metadata.enabled === false);

  imports.add('import java.util.UUID;');

  // Check if audit fields are needed
  if (aggregate.auditable || aggregate.softDelete) {
    imports.add('import java.time.Instant;');
  }

  // Check all properties for additional types
  for (const prop of aggregate.properties || []) {
    // List[T] — add List/ArrayList + imports for the element type
    if (isListType(prop.type)) {
      imports.add('import java.util.List;');
      imports.add('import java.util.ArrayList;');
      const innerType = getListElementType(prop.type);
      if (innerType) {
        const innerEnumWrapperMatch = /^Enum<(.+)>$/.exec(innerType);
        const resolvedInner = innerEnumWrapperMatch ? innerEnumWrapperMatch[1] : innerType;
        if (isValueObjectType(resolvedInner, bcYaml)) {
          imports.add(`import ${pkg}.${bc}.domain.valueobject.${resolvedInner};`);
        } else if (innerEnumWrapperMatch != null || isEnumType(resolvedInner, bcYaml)) {
          imports.add(`import ${pkg}.${bc}.domain.enums.${resolvedInner};`);
        } else {
          try {
            const mapped = mapType(innerType);
            if (mapped.importHint) imports.add(`import ${mapped.importHint};`);
          } catch (_) { /* skip */ }
        }
      }
      continue;
    }
    const enumWrapperMatch = /^Enum<(.+)>$/.exec(prop.type);
    const resolvedType = enumWrapperMatch ? enumWrapperMatch[1] : prop.type;
    const isVO = isValueObjectType(resolvedType, bcYaml);
    const isEnum = enumWrapperMatch != null || isEnumType(resolvedType, bcYaml);

    if (isVO) {
      imports.add(`import ${pkg}.${bc}.domain.valueobject.${resolvedType};`);
    } else if (isEnum) {
      imports.add(`import ${pkg}.${bc}.domain.enums.${resolvedType};`);
    } else {
      try {
        const mapped = mapType(prop.type, prop);
        if (mapped.importHint) imports.add(`import ${mapped.importHint};`);
      } catch (_) {
        // skip unknown types
      }
    }
  }

  // Child entities
  if ((aggregate.entities || []).length > 0) {
    imports.add('import java.util.List;');
    imports.add('import java.util.ArrayList;');
    for (const entity of aggregate.entities) {
      imports.add(`import ${pkg}.${bc}.domain.entity.${entity.name};`);
    }
  }

  // Domain events infrastructure
  if (publishedEvents && publishedEvents.length > 0) {
    imports.add('import java.util.List;');
    imports.add('import java.util.ArrayList;');
    imports.add('import java.util.Collections;');
    imports.add(`import ${pkg}.shared.domain.DomainEvent;`);
    if (metadataEnabled) {
      imports.add(`import ${pkg}.shared.domain.EventMetadata;`);
    }
    for (const event of publishedEvents) {
      imports.add(`import ${pkg}.${bc}.domain.events.${event.name}Event;`);
      // If any payload field is a DateTime/Instant not on the aggregate, Instant.now() is generated
      const aggregatePropNames = new Set((aggregate.properties || []).map((pr) => pr.name));
      const needsInstantForEvent = (event.payload || []).some(
        (p) => (p.type === 'DateTime' || p.type === 'Instant') && !aggregatePropNames.has(p.name)
      );
      if (needsInstantForEvent) imports.add('import java.time.Instant;');
    }
  }

  // Instant for audit (if not already added above)
  if (aggregate.auditable) imports.add('import java.time.Instant;');
  if (aggregate.softDelete) imports.add('import java.time.Instant;');

  // Business method param types
  for (const method of businessMethods || []) {
    for (const param of method.params || []) {
      const jt = param.javaType;
      if (jt === 'UUID') continue; // already imported

      // List<X> — add java.util.List and resolve the inner type's import
      const listInnerMatch = /^List<(.+)>$/.exec(jt);
      if (listInnerMatch) {
        imports.add('import java.util.List;');
        const inner = listInnerMatch[1];
        if (isValueObjectType(inner, bcYaml)) {
          imports.add(`import ${pkg}.${bc}.domain.valueobject.${inner};`);
        } else if ((bcYaml.eventDtos || []).some((d) => d.name === inner)) {
          imports.add(`import ${pkg}.${bc}.application.dtos.incoming.${inner};`);
        } else if (isEnumType(inner, bcYaml)) {
          imports.add(`import ${pkg}.${bc}.domain.enums.${inner};`);
        } else {
          try {
            const mapped = mapType(inner, {});
            if (mapped.importHint) imports.add(`import ${mapped.importHint};`);
          } catch (_) { /* skip unknown inner type */ }
        }
        continue;
      }

      if (jt === 'Instant') {
        imports.add('import java.time.Instant;');
      } else if (jt === 'URI') {
        imports.add('import java.net.URI;');
      } else if (jt === 'BigDecimal') {
        imports.add('import java.math.BigDecimal;');
      } else if (jt === 'LocalDate') {
        imports.add('import java.time.LocalDate;');
      } else if (isValueObjectType(jt, bcYaml)) {
        imports.add(`import ${pkg}.${bc}.domain.valueobject.${jt};`);
      } else if ((bcYaml.eventDtos || []).some((d) => d.name === jt)) {
        imports.add(`import ${pkg}.${bc}.application.dtos.incoming.${jt};`);
      } else if (isEnumType(jt, bcYaml)) {
        imports.add(`import ${pkg}.${bc}.domain.enums.${jt};`);
      }
    }
  }

  return [...imports].sort();
}

// ─── Helper: build imports for a child entity class ──────────────────────────
function buildChildEntityImports(entity, bcYaml, config) {
  const bc = bcYaml.bc;
  const pkg = config.packageName;
  const imports = new Set();

  imports.add('import java.util.UUID;');

  for (const prop of entity.properties || []) {
    if (prop.name === 'id') continue; // UUID already imported

    const enumWrapperMatch = /^Enum<(.+)>$/.exec(prop.type);
    const resolvedType = enumWrapperMatch ? enumWrapperMatch[1] : prop.type;
    const isVO = isValueObjectType(resolvedType, bcYaml);
    const isEnum = enumWrapperMatch != null || isEnumType(resolvedType, bcYaml);

    if (isVO) {
      imports.add(`import ${pkg}.${bc}.domain.valueobject.${resolvedType};`);
    } else if (isEnum) {
      imports.add(`import ${pkg}.${bc}.domain.enums.${resolvedType};`);
    } else {
      try {
        const mapped = mapType(prop.type, prop);
        if (mapped.importHint) imports.add(`import ${mapped.importHint};`);
      } catch (_) {
        // skip unknown
      }
    }
  }

  return [...imports].sort();
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Generates domain aggregate root + child entity classes for a BC.
 *
 * @param {object} bcYaml    — parsed BC YAML document
 * @param {object} config    — {packageName, ...}
 * @param {string} outputDir — root output directory
 */
async function generateAggregates(bcYaml, config, outputDir) {
  const aggregates = bcYaml.aggregates || [];
  if (aggregates.length === 0) return;

  const bc = bcYaml.bc;
  const packagePath = toPackagePath(config.packageName);
  const aggregateDir = path.join(outputDir, 'src', 'main', 'java', packagePath, bc, 'domain', 'aggregate');
  const entityDir = path.join(outputDir, 'src', 'main', 'java', packagePath, bc, 'domain', 'entity');

  const bcEnums = bcYaml.enums || [];
  const useCases = bcYaml.useCases || [];
  const publishedEvents = (bcYaml.domainEvents || {}).published || [];

  // Phase 1 — feature flag for canonical EventMetadata on every event record.
  const metadataEnabled = !(config.events && config.events.metadata && config.events.metadata.enabled === false);
  const eventConfig = { bcName: bc, metadataEnabled };

  for (const aggregate of aggregates) {
    // ── 0. Determine if this aggregate is a read model (no domain events) ────────
    const isReadModel = aggregate.readModel === true;

    // Filter published events to this aggregate only; read models never raise events
    const aggregatePublishedEvents = isReadModel
      ? []
      : publishedEvents.filter((e) => !e.aggregate || e.aggregate === aggregate.name);

    // [Phase 3, Gap E1.d] When the aggregate declares a `terminalState`
    // domainRule with an `errorCode`, transitions in this aggregate are
    // wrapped in a try/catch that converts the generic
    // `InvalidStateTransitionException` into the declared domain error.
    let terminalStateErrorClass = null;
    {
      const tsRule = (aggregate.domainRules || []).find(
        (r) => r.type === 'terminalState' && r.errorCode
      );
      if (tsRule) {
        const errEntry = (bcYaml.errors || []).find((e) => e.code === tsRule.errorCode);
        if (errEntry) {
          terminalStateErrorClass = errEntry.errorType || deriveErrorTypeLocal(errEntry.code);
        }
      }
    }

    // ── 1. Build scalar fields (from YAML properties, excluding id and audit) ──
    const allProps = aggregate.properties || [];
    const scalarFields = allProps
      .filter((p) => p.name !== 'id') // id is always first, handled separately
      .map((p) => {
        let javaType;
        if (isValueObjectType(p.type, bcYaml)) {
          javaType = p.type;
        } else if (isEnumType(p.type, bcYaml)) {
          javaType = p.type;
        } else {
          try {
            javaType = mapType(p.type, p).javaType;
          } catch (_) {
            javaType = p.type; // pass through unknown types
          }
        }
        return {
          name: p.name,
          javaType,
          readOnly: !!p.readOnly,
          defaultValue: p.defaultValue,
          internal: !!p.internal,
          hidden: !!p.hidden,
          isList: isListType(p.type),
        };
      });

    // ── 2. Build child entity metadata ─────────────────────────────────────────
    const childEntities = (aggregate.entities || []).map((entity) => {
      // S6 — cardinality + relationship (defaults: oneToMany + composition)
      const cardinality = entity.cardinality === 'oneToOne' ? 'oneToOne' : 'oneToMany';
      const relationship = entity.relationship === 'aggregation' ? 'aggregation' : 'composition';
      const isOneToOne = cardinality === 'oneToOne';
      const fieldName = isOneToOne
        ? toCamelCase(entity.name)
        : toCamelCase(pluralizeWord(entity.name));
      const javaType = isOneToOne ? entity.name : `List<${entity.name}>`;
      return {
        name: entity.name,
        fieldName,
        javaType,
        immutable: !!entity.immutable,
        cardinality,
        relationship,
        isOneToOne,
      };
    });

    // ── 3. Creation constructor params ─────────────────────────────────────────
    // Exclude: id (auto-UUID), readOnly with defaultValue, audit/softDelete fields
    const creationParams = allProps
      .filter((p) => {
        if (p.name === 'id') return false;
        if (ALWAYS_EXCLUDE_FROM_CREATION.has(p.name)) return false;
        if (p.readOnly && p.defaultValue != null) return false;
        return true;
      })
      .map((p) => {
        let javaType;
        if (isValueObjectType(p.type, bcYaml)) {
          javaType = p.type;
        } else if (isEnumType(p.type, bcYaml)) {
          javaType = p.type;
        } else {
          try {
            javaType = mapType(p.type, p).javaType;
          } catch (_) {
            javaType = p.type;
          }
        }
        return { name: p.name, javaType, isList: isListType(p.type) };
      });

    // ── 4. Auto-initialized fields (readOnly with defaultValue) ───────────────
    const autoInits = allProps
      .filter((p) => p.name !== 'id' && p.readOnly && p.defaultValue != null)
      .map((p) => {
        let enumType = null;
        const enumWrapperMatch = /^Enum<(.+)>$/.exec(p.type);
        if (enumWrapperMatch) enumType = enumWrapperMatch[1];
        else if (isEnumType(p.type, bcYaml)) enumType = p.type;

        let value;
        if (p.defaultValue === 'generated') {
          value = 'UUID.randomUUID()';
        } else if (p.defaultValue === 'now()') {
          value = 'java.time.Instant.now()';
        } else if (enumType) {
          value = `${enumType}.${p.defaultValue}`;
        } else if (typeof p.defaultValue === 'boolean') {
          value = String(p.defaultValue);
        } else if (p.type === 'Integer' || p.type === 'Long') {
          value = String(p.defaultValue);
        } else if (p.type === 'Decimal') {
          value = `new BigDecimal("${p.defaultValue}")`;
        } else {
          value = JSON.stringify(String(p.defaultValue));
        }
        return { name: p.name, value };
      });

    // ── 5. Collect business methods from domainMethods (NEW: explicit typed params) ─
    const seenMethods = new Set();
    const businessMethods = [];

    let staticFactory = null;
    let softDeleteUc = null; // UC with method: delete on a softDelete aggregate

    for (const uc of useCases) {
      if (uc.type !== 'command') continue;
      if (!uc.method) continue;
      if (uc.aggregate !== aggregate.name) continue;
      if (seenMethods.has(uc.method)) continue;
      seenMethods.add(uc.method);

      // ── Static factory: 'create' method with returns = aggregate name ────────
      if (uc.method === 'create') {
        const dmCreate = (aggregate.domainMethods || []).find((m) => m.name === 'create');
        if (dmCreate && dmCreate.returns === aggregate.name) {
          const factoryParams = (dmCreate.params || []).map((p) => ({
            name: p.name,
            javaType: resolveParamType(p.name, aggregate.properties, aggregate.entities, p.type, bcYaml),
          }));
          const factoryParamNames = new Set(factoryParams.map((p) => p.name));
          // Constructor receives ALL creationParams; factory maps each one:
          // — dm.params fields → pass argument directly
          // — readOnly fields not in dm.params (e.g. slug) → null TODO for Phase 3
          const ctorCallArgs = creationParams.map((p) =>
            factoryParamNames.has(p.name) ? p.name : `null /* TODO: compute ${p.name} */`
          ).join(', ');
          const dmCreateEmits = (dmCreate.emitsList && dmCreate.emitsList.length > 0) ? dmCreate.emitsList : null;
          const raiseCall = buildRaiseCall(dmCreateEmits, aggregatePublishedEvents, aggregate, dmCreate.params || [], eventConfig);
          // Split rule IDs into validate vs sideEffect so the scaffold comment
          // distinguishes invariant checks from required side effects (S13).
          const ruleByIdF = new Map((aggregate.domainRules || []).map((r) => [r.id, r]));
          const validateRulesF = [];
          const sideEffectRulesF = [];
          for (const id of (uc.rules || [])) {
            const r = ruleByIdF.get(id);
            if (r && r.type === 'sideEffect') sideEffectRulesF.push(id);
            else validateRulesF.push(id);
          }
          let scaffoldRulesComment = null;
          if (uc.implementation === 'scaffold' && (uc.rules || []).length > 0) {
            let c = `// TODO: implement business logic — ver ${bc}-flows.md`;
            if (validateRulesF.length > 0) c += `\n        // Validate: ${validateRulesF.join(', ')}`;
            if (sideEffectRulesF.length > 0) c += `\n        // Side effects: ${sideEffectRulesF.join(', ')}`;
            scaffoldRulesComment = c;
          }
          staticFactory = {
            params: factoryParams,
            ctorCallArgs,
            raiseCall: raiseCall || null,
            derivedFrom: `${uc.id} ${uc.name}`,
            scaffoldRulesComment,
          };
        }
        continue;
      }

      // Look up the domainMethod definition for explicit typed params
      const dm = (aggregate.domainMethods || []).find((m) => m.name === uc.method);
      if (!dm) continue; // defensive — should have been caught by bc-yaml-reader validation

      // Resolve Java types for each parameter using explicit dm.params[].type as typeHint
      const params = (dm.params || []).map((p) => ({
        name: p.name,
        javaType: resolveParamType(p.name, aggregate.properties, aggregate.entities, p.type, bcYaml),
        optional: false,
      }));

      // ── When aggregate has softDelete: true and the method is "delete",
      //    skip generating delete() — the auto-inject below will emit softDelete() instead.
      if (dm.name === 'delete' && aggregate.softDelete === true) {
        softDeleteUc = uc; // carry rules and derivedFrom to the auto-inject block
        continue;
      }

      const returnType = resolveReturnType(dm.returns, aggregate.name);
      // computeMethodBody receives a sig-like object with {name, params, emits}
      const dmEmits = (dm.emitsList && dm.emitsList.length > 0) ? dm.emitsList : null;
      const sigForBody = { name: dm.name, params: (dm.params || []).map((p) => ({ name: p.name, optional: false, typeHint: p.type })), emits: dmEmits };
      const body = computeMethodBody(uc, sigForBody, aggregate, bcEnums, bc, aggregatePublishedEvents, eventConfig, terminalStateErrorClass);

      businessMethods.push({
        name: dm.name,
        params,
        returnType,
        derivedFrom: `${uc.id} ${uc.name}`,
        body,
      });
    }

    // ── Auto-inject softDelete() when aggregate has softDelete: true but no UC covers it
    if (aggregate.softDelete && !seenMethods.has('softDelete')) {
      const deleteRules = softDeleteUc ? (softDeleteUc.rules || []) : [];
      // S13 split: deleteGuard / uniqueness rules → Validate; sideEffect rules → Side effects.
      const ruleByIdSD = new Map((aggregate.domainRules || []).map((r) => [r.id, r]));
      const validateRulesSD = [];
      const sideEffectRulesSD = [];
      for (const id of deleteRules) {
        const r = ruleByIdSD.get(id);
        if (r && r.type === 'sideEffect') sideEffectRulesSD.push(id);
        else validateRulesSD.push(id);
      }
      let softDeleteBody;
      if (deleteRules.length > 0) {
        let c = `// TODO: implement business logic — ver ${bc}-flows.md`;
        if (validateRulesSD.length > 0) c += `\n        // Validate: ${validateRulesSD.join(', ')}`;
        if (sideEffectRulesSD.length > 0) c += `\n        // Side effects: ${sideEffectRulesSD.join(', ')}`;
        softDeleteBody = `${c}\n        this.deletedAt = Instant.now();`;
      } else {
        softDeleteBody = 'this.deletedAt = Instant.now();';
      }
      businessMethods.push({
        name: 'softDelete',
        params: [],
        returnType: 'void',
        derivedFrom: softDeleteUc ? `${softDeleteUc.id} ${softDeleteUc.name}` : 'softDelete: true',
        body: softDeleteBody,
      });
    }

    // ── 6. Build imports (after businessMethods so param types are included) ──
    const imports = buildImports(aggregate, bcYaml, config, businessMethods, aggregatePublishedEvents);

    // [Phase 3, Gap E1.d] Imports required by terminalState try/catch wrapper.
    if (terminalStateErrorClass) {
      const errImp = `import ${config.packageName}.${bc}.domain.errors.${terminalStateErrorClass};`;
      if (!imports.includes(errImp)) imports.push(errImp);
      const isteImp = `import ${config.packageName}.shared.domain.customExceptions.InvalidStateTransitionException;`;
      if (!imports.includes(isteImp)) imports.push(isteImp);
    }

    // ── 6.b Validation checks for the creation constructor ─────────────────────
    // Aggregates apply DSL `validations[]` on creation; the reconstruction ctor
    // skips them (data is already persisted). Update/addX methods are user-coded
    // (scaffold); checks are not auto-injected there.
    const creationChecks = [];
    const validationImports = new Set();
    for (const cp of creationParams) {
      const propDef = (aggregate.properties || []).find((p) => p.name === cp.name);
      if (!propDef) continue;
      const { lines, imports: extraImps } = buildDomainChecks(propDef);
      if (lines.length > 0) {
        creationChecks.push(...lines);
        creationChecks.push('');
      }
      extraImps.forEach((i) => validationImports.add(i));
    }
    validationImports.forEach((imp) => {
      const stmt = `import ${imp};`;
      if (!imports.includes(stmt)) imports.push(stmt);
    });

    // ── 7. Render aggregate root ───────────────────────────────────────────────
    const context = {
      packageName: config.packageName,
      bc,
      name: aggregate.name,
      description: aggregate.description || '',
      hasAudit: !!aggregate.auditable,
      hasSoftDelete: !!aggregate.softDelete,
      hasDomainEvents: aggregatePublishedEvents.length > 0,
      hasChildEntities: childEntities.length > 0,
      imports,
      fields: scalarFields,
      childEntities,
      creationParams,
      autoInits,
      creationChecks,
      staticFactory,
      businessMethods,
    };

    const destPath = path.join(aggregateDir, `${aggregate.name}.java`);
    await renderAndWrite(
      path.join(TEMPLATES_DIR, 'domain', 'AggregateRoot.java.ejs'),
      destPath,
      context
    );

    // ── 8. Render child entities ───────────────────────────────────────────────
    for (const entity of aggregate.entities || []) {
      const entityImports = buildChildEntityImports(entity, bcYaml, config);

      const entityFields = (entity.properties || [])
        .filter((p) => p.name !== 'id')
        .map((p) => {
          let javaType;
          if (isValueObjectType(p.type, bcYaml)) {
            javaType = p.type;
          } else if (isEnumType(p.type, bcYaml)) {
            javaType = p.type;
          } else {
            try {
              javaType = mapType(p.type, p).javaType;
            } catch (_) {
              javaType = p.type;
            }
          }
          return {
            name: p.name,
            javaType,
            readOnly: !!p.readOnly,
            defaultValue: p.defaultValue,
          };
        });

      const entityCreationParams = (entity.properties || [])
        .filter((p) => {
          if (p.name === 'id') return false;
          if (ALWAYS_EXCLUDE_FROM_CREATION.has(p.name)) return false;
          if (p.readOnly && p.defaultValue != null) return false;
          return true;
        })
        .map((p) => {
          let javaType;
          if (isValueObjectType(p.type, bcYaml)) {
            javaType = p.type;
          } else if (isEnumType(p.type, bcYaml)) {
            javaType = p.type;
          } else {
            try {
              javaType = mapType(p.type, p).javaType;
            } catch (_) {
              javaType = p.type;
            }
          }
          return { name: p.name, javaType };
        });

      // Auto-inits for entity (e.g., changedAt: readOnly, defaultValue: now())
      const entityAutoInits = (entity.properties || [])
        .filter((p) => p.name !== 'id' && p.readOnly && p.defaultValue != null)
        .map((p) => {
          let enumType = null;
          const enumWrapperMatch = /^Enum<(.+)>$/.exec(p.type);
          if (enumWrapperMatch) enumType = enumWrapperMatch[1];
          else if (isEnumType(p.type, bcYaml)) enumType = p.type;

          let value;
          if (p.defaultValue === 'generated') {
            value = 'UUID.randomUUID()';
          } else if (p.defaultValue === 'now()') {
            value = 'java.time.Instant.now()';
          } else if (enumType) {
            value = `${enumType}.${p.defaultValue}`;
          } else if (typeof p.defaultValue === 'boolean') {
            value = String(p.defaultValue);
          } else if (p.type === 'Integer' || p.type === 'Long') {
            value = String(p.defaultValue);
          } else if (p.type === 'Decimal') {
            value = `new BigDecimal("${p.defaultValue}")`;
          } else {
            value = JSON.stringify(String(p.defaultValue));
          }
          return { name: p.name, value };
        });

      const entityContext = {
        packageName: config.packageName,
        bc,
        name: entity.name,
        description: entity.description || '',
        immutable: !!entity.immutable,
        imports: entityImports,
        fields: entityFields,
        creationParams: entityCreationParams,
        autoInits: entityAutoInits,
        creationChecks: (() => {
          const checks = [];
          const validationImports = new Set();
          for (const cp of entityCreationParams) {
            const propDef = (entity.properties || []).find((p) => p.name === cp.name);
            if (!propDef) continue;
            const { lines, imports: extraImps } = buildDomainChecks(propDef);
            if (lines.length > 0) {
              checks.push(...lines);
              checks.push('');
            }
            extraImps.forEach((i) => validationImports.add(i));
          }
          validationImports.forEach((imp) => {
            const stmt = `import ${imp};`;
            if (!entityImports.includes(stmt)) entityImports.push(stmt);
          });
          return checks;
        })(),
      };

      const entityDestPath = path.join(entityDir, `${entity.name}.java`);
      await renderAndWrite(
        path.join(TEMPLATES_DIR, 'domain', 'ChildEntity.java.ejs'),
        entityDestPath,
        entityContext
      );
    }
  }
}

module.exports = { generateAggregates };
