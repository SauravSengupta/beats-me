/**
 * Intro voicing tiers — what plays during the intro section.
 *
 * Kick (pulse) and bass are ALWAYS 0 in every tier. The kick+bass entry
 * at A1 is the defining structural moment of the arrangement.
 */

export interface VoicingTier {
  name: string;
  sparkle: number;
  rhythm: number;
  groove: number;
  pulse: number;     // always 0
  pad: number;       // always 1
  bass: number;      // always 0
  stab: number;
  stabGroove: number;
  arp: number;
}

export const VOICING_TIERS: VoicingTier[] = [
  // Minimal: pad only — maximum space, dreamwave feel
  { name: 'minimal',    sparkle: 0,   rhythm: 0,   groove: 0,   pulse: 0, pad: 1, bass: 0, stab: 0,   stabGroove: 0,   arp: 0   },
  // Sparse: pad + stab + arp — current short arrangement behavior
  { name: 'sparse',     sparkle: 0,   rhythm: 0,   groove: 0,   pulse: 0, pad: 1, bass: 0, stab: 0.4, stabGroove: 0,   arp: 0.3 },
  // Textured: pad + stab + stabGroove + arp — busier, more melodic content
  { name: 'textured',   sparkle: 0,   rhythm: 0,   groove: 0,   pulse: 0, pad: 1, bass: 0, stab: 0.4, stabGroove: 0.3, arp: 0.3 },
  // Rhythmic: pad + stab + arp + hats — has pulse without the weight
  { name: 'rhythmic',   sparkle: 0,   rhythm: 0.5, groove: 0,   pulse: 0, pad: 1, bass: 0, stab: 0.4, stabGroove: 0,   arp: 0.3 },
  // Full-light: pad + stab + arp + hats + cymbals — close to a groove, no low end
  { name: 'full-light', sparkle: 0.4, rhythm: 0.5, groove: 0,   pulse: 0, pad: 1, bass: 0, stab: 0.4, stabGroove: 0,   arp: 0.3 },
  // Edgy: pad + stab + arp + snares — snare without kick is tense
  { name: 'edgy',       sparkle: 0,   rhythm: 0,   groove: 0.4, pulse: 0, pad: 1, bass: 0, stab: 0.4, stabGroove: 0,   arp: 0.3 },
];
