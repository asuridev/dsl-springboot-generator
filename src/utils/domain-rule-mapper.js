/**
 * domain-rule-mapper.js
 *
 * Declarative mapping from `domainRules[].type` → Java code emission.
 *
 * Each mapper consumes a rule object (validated by bc-yaml-reader) and a
 * generation context, and returns a descriptor:
 *
 *   {
 *     lines:        string[]   // Java statements to inject (already indented with 8 spaces)
 *     extraImports: string[]   // FQNs to add to the file imports
 *     extraRepos:   {repoName, repoFieldName, importPath}[]  // additional repo deps for the handler
 *     comment:      string|null // optional documentation comment
 *   }
 *
 * If a rule cannot be reduced to executable code (missing optional hints in YAML),
 * the mapper returns a TODO comment instead of throwing — the generator stays
 * deterministic, and the user is responsible for completing the design.
 *
 * The generator NEVER infers semantics: hints absent → comment scaffold; hints
 * present → executable check.
 */
'use strict';

function toCamelCase(s) {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function emptyResult() {
  return { lines: [], extraImports: [], extraRepos: [], comment: null };
}

/**
 * Build the repository dependency descriptor for an aggregate.
 */
function repoDescriptor(aggregateName, packageName, moduleName) {
  const repoType = `${aggregateName}Repository`;
  return {
    repoName: repoType,
    repoFieldName: `${toCamelCase(aggregateName)}Repository`,
    importPath: `${packageName}.${moduleName}.domain.repository.${repoType}`,
  };
}

/**
 * Follow the explicit YAML trace `rule.id → repository.method.derivedFrom`.
 * Scans every repository's `methods[]` and `queryMethods[]` for a method whose
 * `derivedFrom` equals the rule id, and returns the owning aggregate + method
 * name. Deterministic: it only reads what the YAML already declares.
 */
function findRepoMethodByDerivedFrom(ruleId, bcYaml) {
  for (const repo of (bcYaml?.repositories || [])) {
    const methods = [...(repo.methods || []), ...(repo.queryMethods || [])];
    const m = methods.find((mm) => mm.derivedFrom === ruleId);
    if (m) return { aggregate: repo.aggregate, methodName: m.name || '<method>' };
  }
  return null;
}

function isSameBcAggregate(aggregateName, bcYaml) {
  return (bcYaml?.aggregates || []).some((a) => a.name === aggregateName);
}

/**
 * deleteGuard — guards a delete UC against the existence of dependents in
 * another aggregate.
 *
 * Required YAML hints (validated by bc-yaml-reader):
 *   - targetAggregate: <Aggregate>           (the *other* aggregate that holds the dependents)
 *   - targetRepositoryMethod: <method name>  (e.g. countActiveByCategoryId)
 *
 * Generated Java (inside the handler, before invoking the domain method):
 *
 *     if (productRepository.countActiveByCategoryId(category.getId()) > 0) {
 *         throw new CategoryHasActiveProductsError();
 *     }
 */
function mapDeleteGuard(rule, ctx) {
  const out = emptyResult();
  const { aggVarName, errorMap, packageName, moduleName } = ctx;

  if (!rule.targetAggregate || !rule.targetRepositoryMethod) {
    // Enriched TODO (Phase 3, Gap E1): nominate the Java error class so a
    // Phase-3 implementer can copy/paste a working throw without grepping.
    const errorEntry = errorMap[rule.errorCode];
    const errorType = errorEntry ? errorEntry.errorType : rule.errorCode;
    out.lines.push(`        // TODO domainRule(${rule.id}, deleteGuard): ${rule.description?.trim() || ''}`);
    out.lines.push(`        //      Declare "targetAggregate" + "targetRepositoryMethod" in the YAML to`);
    out.lines.push(`        //      auto-generate the guard, or emit manually:`);
    out.lines.push(`        //      if (<dependentsRepo>.<countMethod>(${aggVarName}.getId()) > 0) throw new ${errorType}();`);
    return out;
  }

  const errorEntry = errorMap[rule.errorCode];
  const errorType = errorEntry ? errorEntry.errorType : rule.errorCode;
  const targetRepo = `${toCamelCase(rule.targetAggregate)}Repository`;
  const targetRepoType = `${rule.targetAggregate}Repository`;

  out.extraRepos.push({
    repoName: targetRepoType,
    repoFieldName: targetRepo,
    importPath: `${packageName}.${moduleName}.domain.repository.${targetRepoType}`,
  });
  out.extraImports.push(`${packageName}.${moduleName}.domain.errors.${errorType}`);

  out.lines.push(`        // domainRule(${rule.id}): ${rule.errorCode}`);
  out.lines.push(`        if (${targetRepo}.${rule.targetRepositoryMethod}(${aggVarName}.getId()) > 0) {`);
  out.lines.push(`            throw new ${errorType}();`);
  out.lines.push(`        }`);
  return out;
}

/**
 * crossAggregateConstraint — guards a UC against the state of another aggregate.
 *
 * Required YAML hints (validated by bc-yaml-reader):
 *   - targetAggregate: <Aggregate>
 *   - field: <field on the source UC input that carries the FK>
 *   - expectedStatus: <enum literal that the target aggregate must hold>
 *
 * Generated Java (inside the handler, before invoking the domain method):
 *
 *     Category category = categoryRepository
 *         .findById(UUID.fromString(command.categoryId()))
 *         .orElseThrow(ProductCategoryNotActiveError::new);
 *     if (category.getStatus() != CategoryStatus.ACTIVE) {
 *         throw new ProductCategoryNotActiveError();
 *     }
 */
function mapCrossAggregateConstraint(rule, ctx) {
  const out = emptyResult();
  const { uc, errorMap, packageName, moduleName, bcYaml, isCreate } = ctx;

  if (!rule.targetAggregate || !rule.field || !rule.expectedStatus) {
    // Enriched TODO (Phase 3, Gap E1): nominate the Java error class.
    // Note: bc-yaml-reader enforces that targetAggregate/field/expectedStatus are
    // declared together, so this branch is only reached when ALL are absent —
    // there is no targetAggregate to derive a repo from. When the hints ARE
    // present, the full branch below already injects the target repository, so
    // there is no missing-injection gap to fill here (Phase 3 rec #1A is a no-op
    // under the current schema).
    const errorEntry = errorMap[rule.errorCode];
    const errorType = errorEntry ? errorEntry.errorType : rule.errorCode;
    out.lines.push(`        // TODO domainRule(${rule.id}, crossAggregateConstraint): ${rule.description?.trim() || ''}`);
    out.lines.push(`        //      Declare "targetAggregate" + "field" + "expectedStatus" in the YAML to`);
    out.lines.push(`        //      auto-generate the guard, or emit manually:`);
    out.lines.push(`        //      if (<targetVar>.getStatus() != <Enum>.<EXPECTED>) throw new ${errorType}();`);
    return out;
  }

  // Verify the target aggregate exists and resolve its status enum
  const targetAgg = (bcYaml?.aggregates || []).find((a) => a.name === rule.targetAggregate);
  if (!targetAgg) {
    out.lines.push(`        // TODO domainRule(${rule.id}): targetAggregate "${rule.targetAggregate}" not found in current BC`);
    return out;
  }
  const statusProp = (targetAgg.properties || []).find((p) =>
    p.type && /Status$/.test(p.type)
  );
  if (!statusProp) {
    out.lines.push(`        // TODO domainRule(${rule.id}): no <Aggregate>Status property found on ${rule.targetAggregate}`);
    return out;
  }
  const statusEnum = statusProp.type;

  // Resolve the input source for the FK
  const inputField = (uc.input || []).find((i) => i.name === rule.field);
  if (!inputField) {
    out.lines.push(`        // TODO domainRule(${rule.id}): input field "${rule.field}" not found in UC inputs`);
    return out;
  }

  const errorEntry = errorMap[rule.errorCode];
  const errorType = errorEntry ? errorEntry.errorType : rule.errorCode;
  const targetVar = toCamelCase(rule.targetAggregate);
  const targetRepo = `${targetVar}Repository`;
  const targetRepoType = `${rule.targetAggregate}Repository`;

  out.extraRepos.push({
    repoName: targetRepoType,
    repoFieldName: targetRepo,
    importPath: `${packageName}.${moduleName}.domain.repository.${targetRepoType}`,
  });
  out.extraImports.push(`${packageName}.${moduleName}.domain.errors.${errorType}`);
  out.extraImports.push(`${packageName}.${moduleName}.domain.aggregate.${rule.targetAggregate}`);
  out.extraImports.push(`${packageName}.${moduleName}.domain.enums.${statusEnum}`);
  out.extraImports.push('java.util.UUID');

  const accessor = isCreate ? 'command' : 'command';
  out.lines.push(`        // domainRule(${rule.id}): ${rule.errorCode}`);
  out.lines.push(`        ${rule.targetAggregate} ${targetVar} = ${targetRepo}`);
  out.lines.push(`            .findById(UUID.fromString(${accessor}.${rule.field}()))`);
  out.lines.push(`            .orElseThrow(${errorType}::new);`);
  out.lines.push(`        if (${targetVar}.get${statusProp.name.charAt(0).toUpperCase() + statusProp.name.slice(1)}() != ${statusEnum}.${rule.expectedStatus}) {`);
  out.lines.push(`            throw new ${errorType}();`);
  out.lines.push(`        }`);
  return out;
}

/**
 * uniqueness — guards a create/update UC against duplicates of a unique field.
 *
 * Optional YAML hint (Phase 3):
 *   - field: <propertyName on the aggregate root>
 *
 * When the hint is declared, the mapper emits:
 *
 *     if (categoryRepository.findByName(command.name()).isPresent()) {
 *         throw new CategoryNameAlreadyExistsError();
 *     }
 *
 * Without the hint, the rule still validates (the property is expected to
 * carry `unique: true`, which JPA enforces via @Column(unique = true)) and an
 * enriched TODO is emitted nominating the error class — no inference.
 */
function mapUniqueness(rule, ctx) {
  const out = emptyResult();
  const { uc, agg, errorMap, packageName, moduleName, isCreate } = ctx;

  const errorEntry = errorMap[rule.errorCode];
  const errorType = errorEntry ? errorEntry.errorType : rule.errorCode;
  const repoFieldName = `${toCamelCase(agg.name)}Repository`;

  if (!rule.field) {
    out.lines.push(`        // TODO domainRule(${rule.id}, uniqueness): ${rule.description?.trim() || ''}`);
    out.lines.push(`        //      Declare "field: <propertyName>" in the YAML to auto-generate the guard, or emit manually:`);
    out.lines.push(`        //      if (${repoFieldName}.findBy<Field>(<source>).isPresent()) throw new ${errorType}();`);
    return out;
  }

  // Resolve the value source: prefer a UC input matching the field name; on update
  // operations, the field may not be in the inputs (immutable update paths) — emit
  // a TODO in that case.
  const inputField = (uc.input || []).find((i) => i.name === rule.field);
  const propDef = (agg.properties || []).find((p) => p.name === rule.field);
  if (!inputField) {
    out.lines.push(`        // TODO domainRule(${rule.id}, uniqueness): UC has no input named "${rule.field}". Emit manually:`);
    out.lines.push(`        //      if (${repoFieldName}.findBy${rule.field.charAt(0).toUpperCase() + rule.field.slice(1)}(<source>).isPresent()) throw new ${errorType}();`);
    return out;
  }

  // Build the value expression from the input type
  let valueExpr;
  if (inputField.source === 'authContext') {
    // Field is injected from SecurityContext, not from the command record
    out.extraImports.push('org.springframework.security.core.context.SecurityContextHolder');
    out.extraImports.push('java.util.UUID');
    valueExpr = `UUID.fromString(SecurityContextHolder.getContext().getAuthentication().getName())`;
  } else if (inputField.type === 'Uuid') {
    valueExpr = `UUID.fromString(command.${rule.field}())`;
    out.extraImports.push('java.util.UUID');
  } else if (inputField.type === 'Url') {
    valueExpr = `URI.create(command.${rule.field}())`;
    out.extraImports.push('java.net.URI');
  } else {
    valueExpr = `command.${rule.field}()`;
  }

  const findMethod = `findBy${rule.field.charAt(0).toUpperCase() + rule.field.slice(1)}`;
  out.extraImports.push(`${packageName}.${moduleName}.domain.errors.${errorType}`);

  // Build constructor args: pass valueExpr for each declared error arg that matches
  // a UC input field, so errors with messageArgs get the correct call signature.
  const errorArgs = errorEntry?.args || [];
  const ctorArgs = errorArgs.map((a) => {
    const matchingInput = (uc.input || []).find((i) => i.name === a.name);
    if (!matchingInput) return 'null';
    if (matchingInput.source === 'authContext') {
      return `UUID.fromString(SecurityContextHolder.getContext().getAuthentication().getName())`;
    }
    if (matchingInput.type === 'Uuid') return `UUID.fromString(command.${a.name}())`;
    if (matchingInput.type === 'Url') return `URI.create(command.${a.name}())`;
    return `command.${a.name}()`;
  });
  const ctorCallArgs = ctorArgs.join(', ');

  out.lines.push(`        // domainRule(${rule.id}): ${rule.errorCode}`);
  if (isCreate) {
    out.lines.push(`        if (${repoFieldName}.${findMethod}(${valueExpr}).isPresent()) {`);
    out.lines.push(`            throw new ${errorType}(${ctorCallArgs});`);
    out.lines.push(`        }`);
  } else {
    // On update operations, allow the same aggregate to keep its current value.
    // The aggregate has been loaded as `<aggVar>` by the time this rule runs.
    const aggVar = ctx.aggVarName;
    out.lines.push(`        ${repoFieldName}.${findMethod}(${valueExpr}).ifPresent(other -> {`);
    out.lines.push(`            if (!other.getId().equals(${aggVar}.getId())) {`);
    out.lines.push(`                throw new ${errorType}(${ctorCallArgs});`);
    out.lines.push(`            }`);
    out.lines.push(`        });`);
  }
  return out;
}

/**
 * statePrecondition — guards a state transition against an invariant on the
 * aggregate's current state. The invariant is too domain-specific to express
 * in YAML today (would need an expression sub-language), so this mapper always
 * emits an enriched TODO that nominates the error class for copy/paste.
 */
function mapStatePrecondition(rule, ctx) {
  const out = emptyResult();
  const { errorMap, aggVarName, bcYaml, packageName, moduleName } = ctx;
  const errorEntry = errorMap[rule.errorCode];
  const errorType = errorEntry ? errorEntry.errorType : rule.errorCode;

  // [Phase 3 #1B] The invariant itself is too domain-specific to express in YAML
  // (it stays a TODO), but the YAML already declares which repository method
  // enforces this rule via `repository.method.derivedFrom == rule.id`. Follow
  // that explicit trace to inject the owning repository — pure wiring, so the
  // Phase 3 implementer has the dependency in scope to complete the guard.
  const traced = findRepoMethodByDerivedFrom(rule.id, bcYaml);
  out.lines.push(`        // TODO domainRule(${rule.id}, statePrecondition): ${rule.description?.trim() || ''}`);
  if (traced && isSameBcAggregate(traced.aggregate, bcYaml)) {
    const repoFieldName = `${toCamelCase(traced.aggregate)}Repository`;
    // `viaMethod` lets the scaffold-handler guide name the enforcement method in
    // its step text; the command-handler template ignores the extra field.
    out.extraRepos.push({
      ...repoDescriptor(traced.aggregate, packageName, moduleName),
      viaMethod: traced.methodName,
    });
    out.lines.push(`        //      Use ${repoFieldName}.${traced.methodName}(...) (derivedFrom ${rule.id}) to enforce the precondition before invoking the domain method:`);
    out.lines.push(`        //      if (!(<invariant>)) throw new ${errorType}();`);
  } else {
    out.lines.push(`        //      Enforce the precondition on ${aggVarName} before invoking the domain method:`);
    out.lines.push(`        //      if (!(<invariant on ${aggVarName}>)) throw new ${errorType}();`);
  }
  return out;
}

/**
 * Public dispatcher.
 *
 * @param rule  - the domainRule object (already validated against the schema)
 * @param ctx   - generation context:
 *                  { uc, agg, aggVarName, errorMap, packageName, moduleName, bcYaml, isCreate }
 * @returns descriptor with lines / extraImports / extraRepos / comment
 */
function mapRule(rule, ctx) {
  switch (rule.type) {
    case 'deleteGuard':
      return mapDeleteGuard(rule, ctx);
    case 'crossAggregateConstraint':
      return mapCrossAggregateConstraint(rule, ctx);
    case 'uniqueness':
      return mapUniqueness(rule, ctx);
    case 'statePrecondition':
      return mapStatePrecondition(rule, ctx);
    case 'terminalState':
    case 'sideEffect':
      // Intentionally inert in the handler — these are emitted as
      // documentation in the aggregate or covered by other generators
      // (terminalState → Enum.transitionTo).
      return emptyResult();
    default:
      return emptyResult();
  }
}

module.exports = { mapRule };
