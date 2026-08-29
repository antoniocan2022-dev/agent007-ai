    expect(content).toContain('authorization == \"DEPLOY_AGENT007_MAIN\"')
    expect(content).toContain('environment: production')
  })

  it('has a serialized production concurrency lock', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    expect(content).toContain('concurrency:')
    expect(content).toContain('group: agent007-production-release')
    expect(content).toContain('cancel-in-progress: false')
  })

  it('requires exact certified source SHA before any production mutation', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    const identity = content.indexOf('Validate authorization and immutable release identity')
    const deploy = content.indexOf('Deploy exact certified main checkout to Vercel production')
    expect(identity).toBeGreaterThanOrEqual(0)
    expect(deploy).toBeGreaterThan(identity)
    expect(content).toContain('git ls-remote origin refs/heads/main')
    expect(content).toContain('Wait for all exact-SHA CI certification gates')
    expect(content).toContain('source_sha=')
    expect(content).toContain('gh api \"repos/${GITHUB_REPOSITORY}/commits/${source_sha}\"')
  })

  it('makes real production traffic ownership the release proof', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    const deploy = content.indexOf('Deploy exact certified main checkout to Vercel production')
    const aliases = content.indexOf('Reconcile canonical production aliases')
    const traffic = content.indexOf('Verify canonical aliases and production traffic identity')
    const health = content.indexOf('Verify fresh production release health')
    expect(deploy).toBeGreaterThanOrEqual(0)
    expect(aliases).toBeGreaterThan(deploy)
    expect(traffic).toBeGreaterThan(aliases)
    expect(health).toBeGreaterThan(traffic)
    expect(content).toContain('TRAFFIC_OWNERSHIP_UNPROVEN')
    expect(content).toContain('STALE_ALIAS')
  })

  it('uses canonical release-health over HTTPS for production traffic identity proof', () => {
    const content = workflowContent(CANONICAL_WORKFLOW)
    const canary = content.slice(content.indexOf('Verify canonical aliases and production traffic identity'), content.indexOf('Verify fresh production release health'))
    expect(canary).toContain('curl --fail-with-body --silent --show-error --max-time 30')
    expect(canary).toContain('\"$PRODUCTION_URL/api/release-health\"')
    expect(canary).toContain('EXPECTED_RELEASE_SHA')
