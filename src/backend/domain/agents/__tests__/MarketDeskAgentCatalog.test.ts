import {
  getMarketDeskAgent,
  listingSeoInputSchema,
  listingSeoOutputSchema,
  normalizeRecommendation,
  recommendationFingerprint,
  seoSourceFingerprint,
} from '../MarketDeskAgentCatalog';

const input = {
  product: {
    id: 'product-1', name: 'Blue chair', description: 'Solid wood chair', category: 'Furniture',
    condition: 'used', tags: ['blue'], imageCount: 3,
  },
  listing: { id: 'listing-1', title: 'Blue chair', description: 'Solid wood chair', marketplace: 'olx' },
};

describe('MarketDeskAgentCatalog', () => {
  it('exposes a stable, tool-free listing-seo profile and rejects unknown agents', () => {
    const profile = getMarketDeskAgent('listing-seo');
    expect(profile.id).toBe('listing-seo');
    expect(profile.version).toBe('1.0.0');
    expect(profile.capabilities).toEqual({ web: false, network: false, terminal: false, filesystem: false, tools: [] });
    expect(() => getMarketDeskAgent('host-skill')).toThrow('Unknown MarketDesk agent');
  });

  it('strictly allowlists input and output fields', () => {
    expect(listingSeoInputSchema.safeParse({ ...input, apiToken: 'secret' }).success).toBe(false);
    expect(listingSeoInputSchema.safeParse({ ...input, product: { ...input.product, internalPath: '/srv/app' } }).success).toBe(false);
    expect(listingSeoOutputSchema.safeParse({ recommendations: [], disclaimer: 'Review only.', command: 'publish' }).success).toBe(false);
  });

  it('changes the safe instruction for each creativity preset without enabling tools', () => {
    const profile = getMarketDeskAgent('listing-seo');
    const instructions = ['precise', 'balanced', 'creative'].map((preset) => profile.instruction(preset as never));
    expect(new Set(instructions).size).toBe(3);
    instructions.forEach((instruction) => expect(instruction).toContain('review-only'));
  });

  it('creates deterministic source-aware normalized recommendation fingerprints', () => {
    const source = seoSourceFingerprint(input);
    expect(normalizeRecommendation('  Better—TITLE!! ')).toBe('better title');
    expect(recommendationFingerprint('listing-seo', '1.0.0', source, 'Better title'))
      .toBe(recommendationFingerprint('listing-seo', '1.0.0', source, ' better—TITLE! '));
    expect(recommendationFingerprint('listing-seo', '1.0.0', source, 'Better title'))
      .not.toBe(recommendationFingerprint('listing-seo', '1.0.0', seoSourceFingerprint({ ...input, product: { ...input.product, name: 'Red chair' } }), 'Better title'));
  });
});
