/**
 * Verification harness for archetype selection.
 *
 * The dish on the plate is built from a recipe chosen off the dish's own
 * words, and choosing the wrong one is not a small error: a cheese bread drawn
 * as a glass of iced tea is worse than drawing nothing. That happened, because
 * the whole description used to be searched — "tear the crust off" matched an
 * unanchored `tea`, and "lemon juice" made hummus a drink.
 *
 *   npx tsx scripts/verify-dish-shapes.ts
 */

import { type DishArchetype, pickArchetype } from '../lib/ar/dish-geometry';

let failures = 0;

function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}

function shape(
  label: string,
  name: string,
  description: string,
  expected: DishArchetype,
): void {
  const got = pickArchetype(name, description);
  check(label, got === expected, got === expected ? '' : `wanted ${expected}, got ${got}`);
}

console.log('\nthe name decides, not the ingredient list');

// Every one of these picked the wrong shape when the description was searched
// as freely as the name.
shape(
  'hummus is a dip, not a drink',
  'حُمُّص Hummus',
  'Chickpeas blended with tahini, lemon juice, garlic and iced water.',
  'generic',
);
shape(
  'khachapuri is bread, not a drink',
  'ხაჭაპური Khachapuri',
  'Bread filled with cheese. You tear the crust off to dip it in the middle.',
  'generic',
);
shape(
  'chana masala is not a drink because it is darkened with tea',
  'छोले Chana masala',
  'Chickpeas stewed with onion and tomato, often darkened with tea.',
  'soup',
);
shape(
  'pad thai is noodles, not a seafood plate',
  'ผัดไทย Pad thai',
  'Flat rice noodles fried with egg, tofu and dried shrimp in a tamarind sauce.',
  'noodles',
);
shape(
  'som tam is a salad, not a seafood plate',
  'ส้มตำ Green papaya salad',
  'Shredded papaya pounded with lime, chilli, fish sauce, peanuts and dried shrimp.',
  'salad',
);
shape(
  'bún chả is noodles, not soup',
  'Bún chả Grilled pork with noodles',
  'Grilled pork dropped into a bowl of warm sweet-and-sour broth.',
  'noodles',
);

console.log('\nthe name still wins outright when it says anything at all');

shape('phở is a soup', 'Phở bò Beef noodle soup', 'Beef broth over flat rice noodles.', 'soup');
shape('ramen is a soup', 'ラーメン Ramen', 'Wheat noodles in pork bone broth.', 'soup');
shape('paella is rice', 'Paella valenciana Paella', 'Rice cooked flat with prawns and mussels.', 'risotto');
shape('a coffee is a drink', 'Cà phê sữa đá Iced coffee', 'Strong coffee dripped over condensed milk and ice.', 'drink');
shape('cheesecake is cake', 'Cheesecake', 'Baked cream cheese on a biscuit base.', 'cake');

console.log('\na description is still consulted when the name says nothing');

shape(
  'bibimbap comes off its description',
  '비빔밥 Bibimbap',
  'A bowl of rice with seasoned vegetables and a fried egg on top.',
  'risotto',
);
shape(
  'bouillabaisse comes off its description',
  'Bouillabaisse',
  'Several kinds of fish simmered with saffron and fennel, the broth served first.',
  'soup',
);
shape('a name alone, with nothing else to go on', 'Zurek staropolski', '', 'generic');

console.log('\nshort words do not match inside longer ones');

for (const [label, inside] of [
  ['"tea" inside "tear" and "instead"', 'You tear it and eat it instead of bread.'],
  ['"pho" inside "phosphate"', 'Dusted with phosphate-free baking powder.'],
  ['a drink word in an ingredient list at all', 'Served warm with a slice of soda bread.'],
] as const) {
  const got = pickArchetype('Mystery plate', inside);
  check(`${label} does not make it a drink`, got !== 'drink', `got ${got}`);
}

console.log(
  failures === 0
    ? '\nAll dish-shape checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`,
);

process.exit(failures === 0 ? 0 : 1);
