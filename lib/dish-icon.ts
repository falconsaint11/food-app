// An emoji for a dish with no photo yet, picked from its name ("Golden Eagle
// Latte" -> ☕) or, when the name doesn't say, its tags. Shown in lists
// (top dishes, the menu, feed cards) so dishes without photos still look
// finished. Never used as a dish's photo on its own page.

// First match wins, so specific words come before general ones
// ("chicken sandwich" is a sandwich, "milkshake" isn't milk).
const BY_NAME: [RegExp, string][] = [
  [/coffee (crumb )?cake|banana bread|cake pop/, '🧁'],
  [/milkshake|\bshakes?\b|frosted|freeze|frappe|blizzard|float/, '🥤'],
  [/smoothie|boba|lemonade|soda|\bcoke\b|cola|dr pepper|sprite|refresher|rebel|myst|\bfizz\b|h2o|slush|juice|punch|sunjoy/, '🥤'],
  [/latte|mocha|espresso|coffee|cold brew|americano|cappuccino|macchiato|breve|chai|cocoa/, '☕'],
  [/\btea\b|matcha/, '🍵'],
  [/beer|\bipa\b|lager|\bale\b|stout/, '🍺'],
  [/\bwine\b|sangria|prosecco|champagne/, '🍷'],
  [/margarita|cocktail|martini|mojito|mimosa|spritz|old fashioned/, '🍸'],
  [/ice ?cream|icedream|gelato|sundae|soft serve|cone|frozen yogurt|froyo/, '🍦'],
  [/donut|doughnut/, '🍩'],
  [/cookie/, '🍪'],
  [/cake|cupcake|cheesecake|cake pop|brownie|muffin/, '🧁'],
  [/\bpie\b|cobbler|churro|dessert|pastry|croissant/, '🥐'],
  [/\bfries\b|\bfry\b|tots|hash brown|potato/, '🍟'],
  [/pancake|waffle|french toast/, '🥞'],
  [/pizza|\bslice\b|calzone|stromboli/, '🍕'],
  [/burger|smash|big mac|whopper|quarter pounder|\bmcdouble\b|cheeseburger/, '🍔'],
  [/hot dog|corn dog|bratwurst/, '🌭'],
  [/burrito|wrap/, '🌯'],
  [/taco|quesadilla|nacho|enchilada|tostada|fajita/, '🌮'],
  [/sushi|sashimi|nigiri|\bpoke\b|california roll|tuna roll|dragon roll/, '🍣'],
  [/ramen|pho|noodle|udon|lo mein|chow mein|pad thai/, '🍜'],
  [/pasta|spaghetti|fettuccine|alfredo|lasagna|penne|ravioli|mac (and|&) cheese|mac n/, '🍝'],
  [/sandwich|sub\b|hoagie|panini|club|melt|biscuit|grill\b|blt/, '🥪'],
  [/salad|kale|greens/, '🥗'],
  [/soup|chili|stew|chowder|bisque/, '🍲'],
  [/wings?\b|nugget|tender|strips|chicken/, '🍗'],
  [/steak|brisket|rib|beef|barbacoa|carnitas|pork/, '🥩'],
  [/shrimp|fish|salmon|tuna|crab|lobster|oyster|seafood/, '🍤'],
  [/egg|omelet|breakfast/, '🍳'],
  [/rice|bowl/, '🍚'],
  [/bread|bagel|toast|knot|pretzel/, '🥖'],
  [/sauce|dip|salsa|guac|queso|dressing/, '🥣'],
  [/water/, '💧'],
];

const BY_TAG: [string, string][] = [
  ['coffee-tea', '☕'],
  ['alcoholic-drink', '🍸'],
  ['drink', '🥤'],
  ['dessert', '🧁'],
  ['pizza', '🍕'],
  ['burger', '🍔'],
  ['mexican', '🌮'],
  ['sushi', '🍣'],
  ['noodles', '🍜'],
  ['pasta', '🍝'],
  ['sandwich', '🥪'],
  ['salad', '🥗'],
  ['soup', '🍲'],
  ['wings', '🍗'],
  ['chicken', '🍗'],
  ['steak', '🥩'],
  ['bbq', '🥩'],
  ['seafood', '🍤'],
  ['breakfast', '🍳'],
  ['side', '🍟'],
  ['appetizer', '🥟'],
];

// Tags that say what a dish is better than its name can ("Basil Chicken
// Ricotta" is a pizza).
const DEFINING_TAGS = ['pizza', 'burger', 'sushi', 'noodles', 'pasta'];

export function dishIcon(name: string, tags: readonly string[] = []) {
  const lower = name.toLowerCase();

  for (const [tag, icon] of BY_TAG) {
    if (DEFINING_TAGS.includes(tag) && tags.includes(tag)) return icon;
  }

  for (const [pattern, icon] of BY_NAME) {
    if (pattern.test(lower)) return icon;
  }

  for (const [tag, icon] of BY_TAG) {
    if (tags.includes(tag)) return icon;
  }

  return '🍽️';
}
