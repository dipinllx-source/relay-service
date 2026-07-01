const { CLAUDE_MODELS } = require('../config/models')

describe('models config', () => {
  it('places Claude Fable 5 as the first Claude model option', () => {
    expect(CLAUDE_MODELS[0]).toEqual({
      value: 'claude-fable-5',
      label: 'Claude Fable 5'
    })
  })

  it('keeps Claude Opus 4.6 available in the static fallback list', () => {
    expect(CLAUDE_MODELS).toContainEqual({
      value: 'claude-opus-4-6',
      label: 'Claude Opus 4.6'
    })
  })
})
