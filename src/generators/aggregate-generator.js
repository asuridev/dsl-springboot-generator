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

// [Phase 3 #3] Rules that require repository access are enforced in the handler,
// not the aggregate. They must NOT be advertised as "Validate" on a domain
// method (the method cannot enforce them — see domain-rule-mapper.js). Rules that
// only read the aggregate's own state (terminalState, statePrecondition) and any
// unknown type stay on the domain method.
const HANDLER_ENFORCED_RULE_TYPES = new Set([
  'uniqueness',
  'crossAggregateConstraint',
  'deleteGuard',
]);

// ─── Helper: classify a UC's domainRule IDs by where they are enforced ────────
function classifyRulesForDomainMethod(ruleIds, aggregate) {
  const ruleById = new Map((aggregate.domainRules || []).map((r) => [r.id, r]));
  const domainMethodRules = []; // terminalState / statePrecondition / unknown → method
  const handlerRules = [];      // uniqueness / crossAggregateConstraint / deleteGuard → handler
  const sideEffectRules = [];   // sideEffect → required side effects
  for (const id of (ruleIds || [])) {
    const r = ruleById.get(id);
    if (r && r.type === 'sideEffect') sideEffectRules.push(id);
    else if (r && HANDLER_ENFORCED_RULE_TYPES.has(r.type)) handlerRules.push(id);
    else domainMethodRules.push(id);
  }
  return { domainMethodRules, handlerRules, sideEffectRules };
}

// Build the comment suffix appended after a scaffold/audit header line. Lists the
// rules the domain method enforces, notes those deferred to the handler, and the
// required side effects. Each line is pre-indented with 8 spaces.
function buildDomainMethodRulesComment(ruleIds, aggregate) {
  const { domainMethodRules, handlerRules, sideEffectRules } =
    classifyRulesForDomainMethod(ruleIds, aggregate);
  let c = '';
  if (domainMethodRules.length > 0) c += `\n        // Validate: ${domainMethodRules.join(', ')}`;
  if (handlerRules.length > 0) c += `\n        // Note: ${handlerRules.join(', ')} (uniqueness/crossAggregate/deleteGuard) are checked in the handler before this method`;
  if (sideEffectRules.length > 0) c += `\n        // Side effects: ${sideEffectRules.join(', ')}`;
  return c;
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
    } catch (err) {
      throw new Error(`Cannot resolve Java type for domain method param "${paramName}" from aggregate property type "${aggrProp.type}": ${err.message}`);
    }
  }

  // 3. Infer from child entity properties
  for (const entity of childEntities || []) {
    const entProp = (entity.properties || []).find((p) => p.name === paramName);
    if (entProp) {
      try {
        return mapType(entProp.type, entProp).javaType;
      } catch (err) {
        throw new Error(`Cannot resolve Java type for domain method param "${paramName}" from child entity property type "${entProp.type}": ${err.message}`);
      }
    }
  }

  // 4. Heuristics by name convention
  if (paramName === 'id' || paramName.endsWith('Id')) return 'UUID';
  if (paramName.endsWith('At')) return 'Instant';
  if (paramName === 'password' || paramName === 'passwordHash') return 'String';

  throw new Error(`Cannot resolve Java type for domain method param "${paramName}". Declare params[].type or use a documented naming convention.`);
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
function buildRaiseCall(eventNameOrList, publishedEvents, aggregate, methodParams, eventConfig = null, bcEnums = []) {
  if (!eventNameOrList) return null;
  if (!publishedEvents || publishedEvents.length === 0) return null;

  if (Array.isArray(eventNameOrList)) {
    const calls = eventNameOrList
      .map((n) => buildRaiseCallSingle(n, publishedEvents, aggregate, methodParams, eventConfig, bcEnums))
      .filter(Boolean);
    if (calls.length === 0) return null;
    return calls.join('\n        ');
  }
  return buildRaiseCallSingle(eventNameOrList, publishedEvents, aggregate, methodParams, eventConfig, bcEnums);
}

function buildRaiseCallSingle(eventName, publishedEvents, aggregate, methodParams, eventConfig = null, bcEnums = []) {
  const event = publishedEvents.find((e) => e.name === eventName);
  if (!event) return null;

  const aggregateCamelId = aggregate.name.charAt(0).toLowerCase() + aggregate.name.slice(1) + 'Id';
  const aggregatePropNames = new Set((aggregate.properties || []).map((pr) => pr.name));
  const aggregatePropByName = new Map((aggregate.properties || []).map((pr) => [pr.name, pr]));
  const methodParamNames = new Set((methodParams || []).map((p) => p.name));
  const methodParamByName = new Map((methodParams || []).map((p) => [p.name, p]));
  const enumNames = new Set((bcEnums || []).map((e) => e.name));

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
  const enumTypeName = (type) => {
    if (!type) return null;
    const match = /^Enum<(.+)>$/.exec(type);
    return match ? match[1] : type;
  };
  const isEnumType = (type) => enumNames.has(enumTypeName(type));
  const isStringType = (type) => /^String(?:\(\d+\))?$/.test(type || '');
  const coerceForPayload = (expr, sourceType, payloadType) => {
    if (isEnumType(sourceType) && isStringType(payloadType)) return `${expr}.name()`;
    return expr;
  };
  // Phase 3: explicit source mapping — payload[].source overrides the heuristic.
  // Supported: aggregate | param | timestamp | constant | auth-context | derived
  const resolveExplicit = (p) => {
    const src = p.source;
    if (!src) return null;
    switch (src) {
      case 'aggregate': {
        const field = p.field || p.name;
        // 'id' or '{aggregateName}Id' (e.g. productId, orderId) both resolve to this.getId()
        if (field === 'id' || field === aggregateCamelId) {
          return 'this.getId()';
        }
        if (!aggregatePropNames.has(field)) {
          unresolved.push(`${p.name} (source: aggregate, field: ${field} not found)`);
          return `null /* TODO domainEvent(${event.name}, ${p.name}): source=aggregate but field "${field}" not in aggregate ${aggregate.name} */`;
        }
        // subField: extract a nested property from a VO field (e.g. deliveryAddress.addressId)
        if (p.subField) {
          return `${getterFor(field)}.get${p.subField.charAt(0).toUpperCase() + p.subField.slice(1)}()`;
        }
        return coerceForPayload(getterFor(field), aggregatePropByName.get(field)?.type, p.type);
      }
      case 'param': {
        const pname = p.param || p.name;
        if (!methodParamNames.has(pname)) {
          unresolved.push(`${p.name} (source: param, param: ${pname} not found)`);
          return `null /* TODO domainEvent(${event.name}, ${p.name}): source=param but parameter "${pname}" not in method signature */`;
        }
        return coerceForPayload(pname, methodParamByName.get(pname)?.type, p.type);
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
    if (aggregatePropNames.has(p.name)) return coerceForPayload(getterFor(p.name), aggregatePropByName.get(p.name)?.type, p.type);
    if (methodParamNames.has(p.name)) return coerceForPayload(p.name, methodParamByName.get(p.name)?.type, p.type);
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

function toScreamingSnake(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toUpperCase();
}

function terminalStateGuard(aggregate, bcEnums, terminalStateErrorClass) {
  if (!terminalStateErrorClass) return null;
  const terminalRule = (aggregate.domainRules || []).find((r) => r.type === 'terminalState' && r.errorCode);
  if (!terminalRule) return null;

  const statusField = (aggregate.properties || []).find((p) => (bcEnums || []).some((e) => e.name === p.type));
  if (!statusField) return null;

  const enumDef = (bcEnums || []).find((e) => e.name === statusField.type);
  if (!enumDef) return null;

  const description = `${terminalRule.description || ''} ${terminalRule.condition || ''} ${terminalRule.state || ''}`;
  let terminalValue = (enumDef.values || []).find((v) => description.includes(v.value));
  if (!terminalValue) {
    terminalValue = (enumDef.values || []).find((v) =>
      Array.isArray(v.transitions) && v.transitions.length === 0 && v.value !== statusField.defaultValue
    );
  }
  if (!terminalValue) return null;

  const getter = `this.${statusField.name}`;
  return `if (${getter} == ${statusField.type}.${terminalValue.value}) {\n            throw new ${terminalStateErrorClass}();\n        }`;
}

function resolveChildNotFoundErrorClass(entity, method, bcYaml) {
  if (method && method.notFoundError) {
    const err = (bcYaml.errors || []).find((e) => e.code === method.notFoundError);
    return err ? (err.errorType || deriveErrorTypeLocal(err.code)) : deriveErrorTypeLocal(method.notFoundError);
  }
  const entityCode = `${toScreamingSnake(entity.name)}_NOT_FOUND`;
  const suffix = entity.name.replace(/^.*?(?=[A-Z][a-z]*$)/, '');
  const suffixCode = `${toScreamingSnake(suffix)}_NOT_FOUND`;
  const err = (bcYaml.errors || []).find((e) => e.code === entityCode || e.code === suffixCode);
  return err ? (err.errorType || deriveErrorTypeLocal(err.code)) : null;
}

function domainErrorClassesInBody(body, bcYaml) {
  const declared = new Map((bcYaml.errors || []).map((e) => [e.errorType || deriveErrorTypeLocal(e.code), e]));
  const result = new Set();
  const re = /(?:new\s+([A-Z][A-Za-z0-9]*Error)\s*\(|\b([A-Z][A-Za-z0-9]*Error)::new\b)/g;
  let match;
  while ((match = re.exec(body || '')) !== null) {
    const errorClass = match[1] || match[2];
    if (declared.has(errorClass)) result.add(errorClass);
  }
  return [...result];
}

// ─── Helper: compute the body string for a business method ───────────────────
function computeMethodBody(uc, sig, aggregate, bcEnums, bcName, publishedEvents, eventConfig = null, terminalStateErrorClass = null, bcYaml = null) {
  const rules = uc.rules || [];
  // [Phase 3 #3] Classify rule IDs by where they are enforced (domain method vs
  // handler vs side effect) so the scaffold comment never advertises a rule the
  // aggregate cannot enforce (e.g. uniqueness / crossAggregateConstraint).
  const rulesComment = buildDomainMethodRulesComment(rules, aggregate);
  const scaffoldBody = `// TODO: implement business logic — ver ${bcName}-flows.md${rulesComment}\n        throw new UnsupportedOperationException("Not implemented yet");`;

  const { name: methodName, params } = sig;
  const guardTerminal = terminalStateGuard(aggregate, bcEnums, terminalStateErrorClass);
  const withTerminalGuard = (body) => guardTerminal ? `${guardTerminal}\n        ${body}` : body;

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
        // [Phase 3 #4] The state transition (and event raise) below IS the
        // generated logic — emit an audit header, not a misleading "implement
        // business logic" TODO. Rule hints (handler-enforced / side effects)
        // are still surfaced via rulesComment.
        let body = `// derived_from: ${uc.id} ${uc.name}${rulesComment}\n`;
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
        const raiseCall = buildRaiseCall(emitsName, publishedEvents, aggregate, params, eventConfig, bcEnums);
        if (raiseCall) body += `\n        ${raiseCall}`;
        return body;
      }
    }
    const raiseCall = buildRaiseCall(sig.emits, publishedEvents, aggregate, params, eventConfig, bcEnums);
    if (raiseCall) {
      // [Phase 3 #4] The event raise below IS real logic — audit header, not a TODO.
      return `// derived_from: ${uc.id} ${uc.name}${rulesComment}\n        ${raiseCall}`;
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
      const raiseCall = buildRaiseCall(emitsName, publishedEvents, aggregate, params, eventConfig, bcEnums);
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
      // Use method params (which are in scope) as ctor args, not entity prop names (GAP-AGG-003)
      const ctorArgs = params.map((p) => p.name).join(', ');
      let body = isOneToOne
        ? `this.${fieldName} = new ${entity.name}(${ctorArgs});`
        : `this.${fieldName}.add(new ${entity.name}(${ctorArgs}));`;
      body = withTerminalGuard(body);
      const raiseCall = buildRaiseCall(sig.emits, publishedEvents, aggregate, params, eventConfig, bcEnums);
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
      const childNotFoundErrorClass = resolveChildNotFoundErrorClass(entity, sig, bcYaml || { errors: [] });
      let body;
      if (isOneToOne) {
        body = childNotFoundErrorClass
          ? `if (this.${fieldName} == null || !this.${fieldName}.getId().equals(${idParam})) {\n            throw new ${childNotFoundErrorClass}();\n        }\n        this.${fieldName} = null;`
          : `if (this.${fieldName} != null && this.${fieldName}.getId().equals(${idParam})) {\n            this.${fieldName} = null;\n        }`;
      } else if (childNotFoundErrorClass) {
        body = `${entity.name} ${varName} = this.${fieldName}.stream()\n            .filter(item -> item.getId().equals(${idParam}))\n            .findFirst()\n            .orElseThrow(${childNotFoundErrorClass}::new);\n        this.${fieldName}.remove(${varName});`;
      } else {
        body = `this.${fieldName}.removeIf(${varName} -> ${varName}.getId().equals(${idParam}));`;
      }
      body = withTerminalGuard(body);
      const raiseCall = buildRaiseCall(sig.emits, publishedEvents, aggregate, params, eventConfig, bcEnums);
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
    body = withTerminalGuard(body);
    const raiseCall = buildRaiseCall(sig.emits, publishedEvents, aggregate, params, eventConfig, bcEnums);
    if (raiseCall) body += `\n        ${raiseCall}`;
    return body;
  }

  // ── Fallback: scaffold ──────────────────────────────────────────
  {
    const raiseCall = buildRaiseCall(sig.emits, publishedEvents, aggregate, params, eventConfig, bcEnums);
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
function buildImports(aggregate, bcYaml, config, businessMethods, publishedEvents, staticFactory = null) {
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
      // If any payload field is a DateTime/Instant not on the aggregate, or uses source:timestamp,
      // Instant.now() is generated and the import is required.
      const aggregatePropNames = new Set((aggregate.properties || []).map((pr) => pr.name));
      const needsInstantForEvent = (event.payload || []).some(
        (p) => p.source === 'timestamp' || ((p.type === 'DateTime' || p.type === 'Instant') && !aggregatePropNames.has(p.name))
      );
      if (needsInstantForEvent) imports.add('import java.time.Instant;');
    }
  }

  // Instant for audit (if not already added above)
  if (aggregate.auditable) imports.add('import java.time.Instant;');
  if (aggregate.softDelete) imports.add('import java.time.Instant;');

  // Business method and static factory param types
  const methodsForParamImports = [...(businessMethods || [])];
  if (staticFactory) methodsForParamImports.push({ params: staticFactory.params || [] });
  for (const method of methodsForParamImports) {
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

  // Business method return types — non-void, non-aggregate class itself (GAP-AGG-005)
  for (const method of businessMethods || []) {
    const rt = method.returnType;
    if (!rt || rt === 'void' || rt === aggregate.name) continue;
    const listReturnMatch = /^List<(.+)>$/.exec(rt);
    if (listReturnMatch) {
      imports.add('import java.util.List;');
      const inner = listReturnMatch[1];
      if (isValueObjectType(inner, bcYaml)) {
        imports.add(`import ${pkg}.${bc}.domain.valueobject.${inner};`);
      } else if (isEnumType(inner, bcYaml)) {
        imports.add(`import ${pkg}.${bc}.domain.enums.${inner};`);
      }
      continue;
    }
    if (isValueObjectType(rt, bcYaml)) {
      imports.add(`import ${pkg}.${bc}.domain.valueobject.${rt};`);
    } else if (isEnumType(rt, bcYaml)) {
      imports.add(`import ${pkg}.${bc}.domain.enums.${rt};`);
    } else {
      try {
        const mapped = mapType(rt, {});
        if (mapped.importHint) imports.add(`import ${mapped.importHint};`);
      } catch (_) { /* skip */ }
    }
  }

  // StoredObject (shared canonical VO, object storage) — referenced by a property,
  // a business-method param/return, or the static factory. Lives in shared.* so it
  // is not caught by the per-BC isValueObjectType checks above.
  const mentionsSO = (t) => typeof t === 'string' && /\bStoredObject\b/.test(t);
  const factoryParams = staticFactory ? (staticFactory.params || []) : [];
  const refsStoredObject =
    (aggregate.properties || []).some((p) => mentionsSO(p.type)) ||
    (businessMethods || []).some((m) =>
      (m.params || []).some((p) => mentionsSO(p.javaType)) || mentionsSO(m.returnType)
    ) ||
    factoryParams.some((p) => mentionsSO(p.javaType));
  if (refsStoredObject) {
    imports.add(`import ${pkg}.shared.domain.valueobject.StoredObject;`);
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

    // List[T] — add List import + resolve inner type import (GAP-AGG-001)
    if (isListType(prop.type)) {
      imports.add('import java.util.List;');
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
            const mapped = mapType(innerType, {});
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
        // skip unknown
      }
    }
  }

  // StoredObject (shared canonical VO, object storage) — not a per-BC VO.
  if ((entity.properties || []).some((p) => typeof p.type === 'string' && /\bStoredObject\b/.test(p.type))) {
    imports.add(`import ${pkg}.shared.domain.valueobject.StoredObject;`);
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
          // Prefer explicit params[]; fall back to parsing signature: string
          let rawParams = (dmCreate.params || []);
          if (rawParams.length === 0 && dmCreate.signature) {
            const parsed = parseMethodSignature(dmCreate.signature);
            if (parsed) rawParams = parsed.params.map((p) => ({ name: p.name, type: p.typeHint }));
          }
          const factoryParams = rawParams.map((p) => ({
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
          const raiseCallRaw = buildRaiseCall(dmCreateEmits, aggregatePublishedEvents, aggregate, dmCreate.params || [], eventConfig, bcYaml.enums || []);
          // In the static factory the variable is named `instance`, not `this`.
          // Strip the "// derived_from: ..." comment prefix (incompatible with inline call)
          // and rewrite `this.` → `instance.` so the call compiles inside a static method.
          let raiseCall = raiseCallRaw || null;
          if (raiseCall) {
            raiseCall = raiseCall
              .replace(/^\/\/[^\n]*\n\s*/, '')   // remove comment line + leading whitespace
              .replace(/\bthis\./g, 'instance.'); // this. → instance. (args inside the event ctor)
          }
          // [Phase 3 #3] Classify rule IDs by enforcement site so the scaffold
          // comment distinguishes invariant checks, handler-enforced rules, and
          // required side effects.
          let scaffoldRulesComment = null;
          if (uc.implementation === 'scaffold' && (uc.rules || []).length > 0) {
            scaffoldRulesComment = `// TODO: implement business logic — ver ${bc}-flows.md${buildDomainMethodRulesComment(uc.rules, aggregate)}`;
          }
          // Early-identity: the aggregate id is generated at the application
          // edge (controller) and flows in through the command. The factory and
          // the creation constructor receive it as their first parameter instead
          // of generating it internally.
          staticFactory = {
            params: [{ name: 'id', javaType: 'UUID' }, ...factoryParams],
            ctorCallArgs: ctorCallArgs ? `id, ${ctorCallArgs}` : 'id',
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

      // Resolve Java types for each parameter using explicit dm.params[].type as typeHint;
      // fall back to parsing signature: string when params[] is absent.
      let rawDmParams = (dm.params || []);
      if (rawDmParams.length === 0 && dm.signature) {
        const parsedDm = parseMethodSignature(dm.signature);
        if (parsedDm) rawDmParams = parsedDm.params.map((p) => ({ name: p.name, type: p.typeHint, optional: p.optional }));
      }
      const params = rawDmParams.map((p) => ({
        name: p.name,
        javaType: resolveParamType(p.name, aggregate.properties, aggregate.entities, p.type, bcYaml),
        optional: p.optional || false,
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
      const sigForBody = { name: dm.name, params: rawDmParams.map((p) => ({ name: p.name, optional: p.optional || false, typeHint: p.type })), emits: dmEmits, notFoundError: dm.notFoundError || uc.childNotFoundError || uc.itemNotFoundError };
      const body = computeMethodBody(uc, sigForBody, aggregate, bcEnums, bc, aggregatePublishedEvents, eventConfig, terminalStateErrorClass, bcYaml);

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
      // [Phase 3 #3] deleteGuard rules are enforced in the handler — classify so
      // they are noted, not advertised as "Validate" on softDelete().
      let softDeleteBody;
      if (deleteRules.length > 0) {
        const c = `// TODO: implement business logic — ver ${bc}-flows.md${buildDomainMethodRulesComment(deleteRules, aggregate)}`;
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

    // [Phase 3 #7] Restrict published-event imports to events this aggregate actually
    // raises. Events with an explicit `aggregate` attribution honor it; un-attributed
    // events are matched by whether a `new <Name>Event(` construction appears in any
    // generated method body or the static factory. This prevents importing another
    // aggregate's events (e.g. ProductActivatedEvent leaking into Category).
    const raisedEventNames = new Set();
    const scanForEvents = (text) => {
      if (!text) return;
      for (const e of aggregatePublishedEvents) {
        if (text.includes(`new ${e.name}Event(`)) raisedEventNames.add(e.name);
      }
    };
    businessMethods.forEach((m) => scanForEvents(m.body));
    if (staticFactory) scanForEvents(staticFactory.raiseCall);
    const ownedPublishedEvents = aggregatePublishedEvents.filter((e) =>
      e.aggregate ? e.aggregate === aggregate.name : raisedEventNames.has(e.name)
    );

    // ── 6. Build imports (after businessMethods so param types are included) ──
    const imports = buildImports(aggregate, bcYaml, config, businessMethods, ownedPublishedEvents, staticFactory);

    // [Phase 3, Gap E1.d] Imports required by terminalState try/catch wrapper.
    if (terminalStateErrorClass) {
      const errImp = `import ${config.packageName}.${bc}.domain.errors.${terminalStateErrorClass};`;
      if (!imports.includes(errImp)) imports.push(errImp);
      const isteImp = `import ${config.packageName}.shared.domain.customExceptions.InvalidStateTransitionException;`;
      if (!imports.includes(isteImp)) imports.push(isteImp);
    }

    for (const method of businessMethods) {
      for (const errorClass of domainErrorClassesInBody(method.body, bcYaml)) {
        const errImp = `import ${config.packageName}.${bc}.domain.errors.${errorClass};`;
        if (!imports.includes(errImp)) imports.push(errImp);
      }
    }

    // ── 6.b Validation checks for the creation constructor ─────────────────────
    // Aggregates apply DSL `validations[]` on creation; the reconstruction ctor
    // skips them (data is already persisted). Update/addX methods are user-coded
    // (scaffold); checks are not auto-injected there.
    const creationChecks = [];
    const validationImports = new Set();
    // factoryCreationChecks: the subset of creation checks that the static
    // factory can run when the creation constructor is elided (collision case).
    // Only fields present in the factory's parameter list are in scope there —
    // creation params resolved to `null /* TODO */` cannot be validated yet.
    const factoryParamFieldNames = staticFactory
      ? new Set(staticFactory.params.map((p) => p.name))
      : new Set();
    const factoryCreationChecks = [];
    for (const cp of creationParams) {
      const propDef = (aggregate.properties || []).find((p) => p.name === cp.name);
      if (!propDef) continue;
      const { lines, imports: extraImps } = buildDomainChecks(propDef);
      if (lines.length > 0) {
        creationChecks.push(...lines);
        creationChecks.push('');
        if (factoryParamFieldNames.has(cp.name)) {
          factoryCreationChecks.push(...lines);
          factoryCreationChecks.push('');
        }
      }
      extraImps.forEach((i) => validationImports.add(i));
    }
    validationImports.forEach((imp) => {
      const stmt = `import ${imp};`;
      if (!imports.includes(stmt)) imports.push(stmt);
    });

    // ── 7. Render aggregate root ───────────────────────────────────────────────
    // Early-identity: the creation constructor now takes `id` as its first
    // parameter, just like the full reconstruction constructor. For "simple"
    // aggregates (no audit/softDelete/version/child entities and no field
    // excluded from creation) the two constructors would have an identical
    // signature — a duplicate-constructor compile error. In that case we skip
    // the dedicated creation constructor and let the static factory build the
    // aggregate through the public full constructor, running creation-time
    // validations in the factory body instead.
    const creationCtorCollides =
      !aggregate.auditable &&
      !aggregate.softDelete &&
      aggregate.concurrencyControl !== 'optimistic' &&
      childEntities.length === 0 &&
      creationParams.length === scalarFields.length;

    const context = {
      packageName: config.packageName,
      bc,
      name: aggregate.name,
      description: aggregate.description || '',
      hasAudit: !!aggregate.auditable,
      hasSoftDelete: !!aggregate.softDelete,
      hasVersion: aggregate.concurrencyControl === 'optimistic',
      hasDomainEvents: ownedPublishedEvents.length > 0,
      hasChildEntities: childEntities.length > 0,
      imports,
      fields: scalarFields,
      childEntities,
      creationParams,
      autoInits,
      creationChecks,
      factoryCreationChecks,
      creationCtorCollides,
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
