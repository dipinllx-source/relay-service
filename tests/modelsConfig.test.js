const { CLAUDE_MODELS } = require('../config/models')

describe('models config', () => {
  it('places Claude Opus 4.6 as the second Claude model option', () => {
    expect(CLAUDE_MODELS[1]).toEqual({
      value: 'claude-opus-4-6',
      label: 'Claude Opus 4.6'
    })
  })
})
