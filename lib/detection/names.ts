/**
 * Common given names (fr / de / it / es / en / pt / nl). Used only to rescue
 * names compromise mis-tags as ORG ("Jean Dupont") and to catch "First Last"
 * pairs it misses. The transformer NER (Phase 3) is the real fix; this keeps
 * the always-on layer from leaking the most common cases.
 */
export const FIRST_NAMES: ReadonlySet<string> = new Set(
  `jean pierre paul jacques michel louis andre rene marc luc alain claude daniel bernard
  philippe nicolas julien thomas antoine francois laurent olivier sebastien stephane
  christophe frederic eric patrick guillaume vincent mathieu mathis maxime alexandre
  etienne hugo lucas leo gabriel arthur raphael adrien benoit cedric damien fabien
  gilles herve lionel yves xavier pascal thierry serge marie anne sophie isabelle
  catherine nathalie sylvie christine monique francoise brigitte martine nicole julie
  camille claire emilie laura lea chloe manon sarah charlotte aurelie celine virginie
  veronique valerie stephanie sandrine florence helene jeanne margot ines louise
  hans peter klaus wolfgang jurgen dieter werner heinz horst uwe stefan thomas michael
  andreas markus matthias tobias florian lukas jonas felix maximilian sebastian
  karl franz josef johann heinrich friedrich gerhard rolf bernd ralf jorg
  anna maria petra sabine monika ursula brigitte renate susanne karin claudia
  katharina christina barbara angelika gabriele heike birgit ingrid eva
  giuseppe giovanni antonio mario luigi francesco paolo marco luca andrea stefano
  alessandro roberto matteo davide simone federico lorenzo giorgio carlo enrico
  giulia francesca chiara sara valentina silvia elena paola laura martina alessia
  juan jose carlos miguel manuel javier pedro luis pablo sergio alberto fernando
  jorge rafael diego alejandro antonio francisco ana carmen lucia isabel pilar
  john james robert michael william david richard joseph charles christopher
  matthew anthony mark donald steven kevin brian george edward ronald timothy
  jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott
  mary patricia jennifer linda elizabeth barbara susan jessica karen nancy lisa
  betty margaret sandra ashley kimberly emily donna michelle carol amanda melissa
  joao antonio tiago pedro rui nuno ricardo jan pieter hendrik willem kees joost
  sven bram daan lotte sanne fleur`.split(/\s+/).filter(Boolean),
);

/** Strip accents + lowercase for list lookup. */
export function nameKey(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function isFirstName(word: string): boolean {
  return FIRST_NAMES.has(nameKey(word));
}

const CAP_WORD = String.raw`\p{Lu}[\p{L}'’]+(?:-\p{Lu}[\p{L}'’]+)*`;
/** "Jean Dupont", "Marie-Claire Le Fèvre" style pairs: capitalised first name + 1-2 capitalised words. */
export const NAME_PAIR_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(${CAP_WORD})(?: (?:(?:de|du|von|van|der|le|la|di|da|del) )?${CAP_WORD}){1,2}(?![\p{L}\p{N}])`,
  'gu',
);

/**
 * "M. Bllaca", "Mme Dupont", "Dr. Keller": an honorific followed by a
 * capitalised word is a person even when no list knows the surname. Group 1 is
 * the name only (the title itself is not PII).
 */
export const TITLE_NAME_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:M|MM|Mme|Mmes|Mlle|Mr|Mrs|Ms|Mx|Dr|Dre|Pr|Prof|Me|Maître|Maitre|Herr|Frau|Hr|Fr|Sig|Sigra|Dott|Sr|Sra|Don|Doña)(?:\.|(?=\s))\s*(${CAP_WORD}(?: (?:(?:de|du|von|van|der|le|la|di|da|del) )?${CAP_WORD}){0,2})(?![\p{L}\p{N}])`,
  'gu',
);
