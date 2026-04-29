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
    out.lines.push(`        // TODO domainRule(${rule.id}, deleteGuard): ${rule.description?.trim() || ''}`);
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
    out.lines.push(`        // TODO domainRule(${rule.id}, crossAggregateConstraint): ${rule.description?.trim() || ''}`);
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
    case 'statePrecondition':
    case 'terminalState':
    case 'sideEffect':
      // Intentionally inert in the handler — these are emitted as
      // documentation in the aggregate or covered by other generators
      // (uniqueness → JPA @Column unique=true; terminalState → Enum.transitionTo).
      return emptyResult();
    default:
      return emptyResult();
  }
}

module.exports = { mapRule };
