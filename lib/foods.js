// Built-in nutrition database derived from USDA FoodData Central
// (Foundation / SR Legacy / FNDDS survey portions). Used as the offline
// fallback and as the source of sensible default portions when the live
// USDA API is unavailable.
//
// Each entry: aliases, emoji, portion label, portion grams, kcal, protein,
// carbs, fat (per portion), and a query string tuned for USDA FDC search.

const FOODS = [
  // ── Coffee & drinks ─────────────────────────────────────────────
  { aliases: ['cappuccino'], emoji: '☕', portion: 'medium, 12 oz', grams: 360, kcal: 120, p: 6, c: 10, f: 6, usda: 'cappuccino' },
  { aliases: ['latte', 'cafe latte', 'caffe latte'], emoji: '☕', portion: 'medium, 12 oz', grams: 360, kcal: 190, p: 10, c: 15, f: 10, usda: 'cafe latte' },
  { aliases: ['black coffee', 'coffee', 'americano', 'drip coffee'], emoji: '☕', portion: '8 oz, black', grams: 240, kcal: 2, p: 0, c: 0, f: 0, usda: 'coffee brewed' },
  { aliases: ['espresso'], emoji: '☕', portion: '1 shot', grams: 30, kcal: 3, p: 0, c: 0, f: 0, usda: 'espresso' },
  { aliases: ['matcha latte'], emoji: '🍵', portion: '12 oz', grams: 360, kcal: 190, p: 7, c: 27, f: 6, usda: 'matcha latte' },
  { aliases: ['chai latte', 'chai'], emoji: '🍵', portion: '12 oz', grams: 360, kcal: 200, p: 6, c: 34, f: 4, usda: 'chai tea latte' },
  { aliases: ['green tea', 'tea'], emoji: '🍵', portion: '1 cup', grams: 240, kcal: 2, p: 0, c: 0, f: 0, usda: 'tea green brewed' },
  { aliases: ['orange juice', 'oj'], emoji: '🧃', portion: '8 oz', grams: 248, kcal: 110, p: 2, c: 26, f: 0, usda: 'orange juice raw' },
  { aliases: ['milk', 'glass of milk'], emoji: '🥛', portion: '1 cup, 2%', grams: 244, kcal: 122, p: 8, c: 12, f: 5, usda: 'milk 2% fat' },
  { aliases: ['protein shake', 'whey shake', 'protein smoothie'], emoji: '🥤', portion: '1 scoop with water', grams: 300, kcal: 130, p: 25, c: 4, f: 2, usda: 'protein powder whey' },
  { aliases: ['smoothie', 'fruit smoothie'], emoji: '🥤', portion: '16 oz', grams: 450, kcal: 280, p: 5, c: 62, f: 2, usda: 'fruit smoothie' },
  { aliases: ['beer'], emoji: '🍺', portion: '12 oz', grams: 355, kcal: 153, p: 2, c: 13, f: 0, usda: 'beer regular' },
  { aliases: ['wine', 'glass of wine', 'red wine', 'white wine'], emoji: '🍷', portion: '5 oz glass', grams: 147, kcal: 123, p: 0, c: 4, f: 0, usda: 'wine table red' },
  { aliases: ['soda', 'coke', 'cola', 'soft drink'], emoji: '🥤', portion: '12 oz can', grams: 368, kcal: 140, p: 0, c: 39, f: 0, usda: 'cola soft drink' },

  // ── Breakfast ───────────────────────────────────────────────────
  { aliases: ['almond croissant'], emoji: '🥐', portion: '1 pastry', grams: 95, kcal: 410, p: 8, c: 42, f: 24, usda: 'croissant almond' },
  { aliases: ['chocolate croissant', 'pain au chocolat'], emoji: '🥐', portion: '1 pastry', grams: 85, kcal: 340, p: 6, c: 38, f: 19, usda: 'croissant chocolate' },
  { aliases: ['croissant'], emoji: '🥐', portion: '1 medium', grams: 57, kcal: 230, p: 5, c: 26, f: 12, usda: 'croissant butter' },
  { aliases: ['bagel with cream cheese'], emoji: '🥯', portion: '1 bagel', grams: 130, kcal: 380, p: 13, c: 58, f: 11, usda: 'bagel with cream cheese' },
  { aliases: ['bagel'], emoji: '🥯', portion: '1 plain', grams: 100, kcal: 280, p: 11, c: 56, f: 2, usda: 'bagel plain' },
  { aliases: ['blueberry pancakes'], emoji: '🥞', portion: '3 pancakes with maple syrup', grams: 250, kcal: 520, p: 9, c: 94, f: 12, usda: 'pancakes blueberry' },
  { aliases: ['pancakes', 'pancake'], emoji: '🥞', portion: '3 with syrup', grams: 230, kcal: 480, p: 8, c: 90, f: 10, usda: 'pancakes plain' },
  { aliases: ['waffles', 'waffle'], emoji: '🧇', portion: '2 with syrup', grams: 180, kcal: 440, p: 8, c: 76, f: 12, usda: 'waffle plain' },
  { aliases: ['french toast'], emoji: '🍞', portion: '2 slices with syrup', grams: 200, kcal: 470, p: 12, c: 70, f: 15, usda: 'french toast' },
  { aliases: ['greek yogurt', 'greek yoghurt'], emoji: '🍶', portion: '1 cup, plain', grams: 245, kcal: 130, p: 17, c: 9, f: 4, usda: 'yogurt greek plain lowfat' },
  { aliases: ['yogurt', 'yoghurt'], emoji: '🍶', portion: '1 cup', grams: 245, kcal: 150, p: 9, c: 17, f: 4, usda: 'yogurt plain whole milk' },
  { aliases: ['oatmeal with blueberries'], emoji: '🥣', portion: '1 bowl', grams: 280, kcal: 290, p: 8, c: 54, f: 5, usda: 'oatmeal cooked with blueberries' },
  { aliases: ['oatmeal', 'porridge', 'oats'], emoji: '🥣', portion: '1 cup, cooked', grams: 234, kcal: 160, p: 6, c: 27, f: 4, usda: 'oatmeal cooked' },
  { aliases: ['granola'], emoji: '🥣', portion: '1/2 cup', grams: 56, kcal: 240, p: 6, c: 33, f: 10, usda: 'granola' },
  { aliases: ['cereal with milk', 'cereal'], emoji: '🥣', portion: '1 bowl with milk', grams: 270, kcal: 250, p: 9, c: 44, f: 5, usda: 'cereal ready to eat with milk' },
  { aliases: ['scrambled eggs'], emoji: '🍳', portion: '2 eggs', grams: 122, kcal: 182, p: 12, c: 2, f: 13, usda: 'egg scrambled' },
  { aliases: ['fried egg', 'fried eggs'], emoji: '🍳', portion: '1 large', grams: 46, kcal: 90, p: 6, c: 0, f: 7, usda: 'egg fried' },
  { aliases: ['boiled egg', 'hard boiled egg', 'hardboiled egg'], emoji: '🥚', portion: '1 large', grams: 50, kcal: 72, p: 6, c: 0, f: 5, usda: 'egg hard-boiled' },
  { aliases: ['eggs', 'egg'], emoji: '🍳', portion: '1 large', grams: 50, kcal: 72, p: 6, c: 0, f: 5, usda: 'egg whole cooked' },
  { aliases: ['omelette', 'omelet'], emoji: '🍳', portion: '2-egg with cheese', grams: 140, kcal: 270, p: 17, c: 2, f: 21, usda: 'egg omelet with cheese' },
  { aliases: ['bacon'], emoji: '🥓', portion: '3 slices', grams: 35, kcal: 161, p: 12, c: 0, f: 12, usda: 'bacon pan-fried' },
  { aliases: ['sausage', 'breakfast sausage'], emoji: '🌭', portion: '2 links', grams: 54, kcal: 180, p: 9, c: 1, f: 15, usda: 'sausage pork link' },
  { aliases: ['avocado toast'], emoji: '🥑', portion: '1 slice', grams: 130, kcal: 250, p: 6, c: 22, f: 16, usda: 'avocado toast' },
  { aliases: ['peanut butter toast', 'toast with peanut butter'], emoji: '🥜', portion: '1 slice', grams: 62, kcal: 270, p: 10, c: 18, f: 17, usda: 'toast with peanut butter' },
  { aliases: ['buttered toast', 'toast with butter', 'toast and butter'], emoji: '🍞', portion: '1 slice, buttered', grams: 35, kcal: 116, p: 3, c: 14, f: 5, usda: 'bread toasted with butter' },
  { aliases: ['toast', 'plain toast', 'dry toast'], emoji: '🍞', portion: '1 slice', grams: 30, kcal: 80, p: 3, c: 14, f: 1, usda: 'bread toasted' },
  { aliases: ['blueberry muffin', 'muffin'], emoji: '🧁', portion: '1 muffin', grams: 110, kcal: 380, p: 6, c: 54, f: 16, usda: 'muffin blueberry' },
  { aliases: ['breakfast burrito'], emoji: '🌯', portion: '1 burrito', grams: 220, kcal: 450, p: 20, c: 40, f: 23, usda: 'breakfast burrito egg' },

  // ── Fruit ───────────────────────────────────────────────────────
  { aliases: ['strawberries', 'strawberry', 'fresh strawberries'], emoji: '🍓', portion: '1 cup, sliced', grams: 166, kcal: 50, p: 1, c: 12, f: 0, usda: 'strawberries raw' },
  { aliases: ['blueberries'], emoji: '🫐', portion: '1 cup', grams: 148, kcal: 84, p: 1, c: 21, f: 0, usda: 'blueberries raw' },
  { aliases: ['banana'], emoji: '🍌', portion: '1 medium', grams: 118, kcal: 105, p: 1, c: 27, f: 0, usda: 'banana raw' },
  { aliases: ['apple'], emoji: '🍎', portion: '1 medium', grams: 182, kcal: 95, p: 0, c: 25, f: 0, usda: 'apple raw with skin' },
  { aliases: ['orange'], emoji: '🍊', portion: '1 medium', grams: 131, kcal: 62, p: 1, c: 15, f: 0, usda: 'orange raw' },
  { aliases: ['grapes'], emoji: '🍇', portion: '1 cup', grams: 151, kcal: 104, p: 1, c: 27, f: 0, usda: 'grapes raw' },
  { aliases: ['watermelon'], emoji: '🍉', portion: '1 cup, diced', grams: 152, kcal: 46, p: 1, c: 12, f: 0, usda: 'watermelon raw' },
  { aliases: ['mango'], emoji: '🥭', portion: '1 cup, pieces', grams: 165, kcal: 99, p: 1, c: 25, f: 1, usda: 'mango raw' },
  { aliases: ['pineapple'], emoji: '🍍', portion: '1 cup, chunks', grams: 165, kcal: 82, p: 1, c: 22, f: 0, usda: 'pineapple raw' },
  { aliases: ['peach'], emoji: '🍑', portion: '1 medium', grams: 150, kcal: 59, p: 1, c: 14, f: 0, usda: 'peach raw' },
  { aliases: ['avocado'], emoji: '🥑', portion: '1/2 avocado', grams: 100, kcal: 160, p: 2, c: 9, f: 15, usda: 'avocado raw' },
  { aliases: ['fruit salad'], emoji: '🍓', portion: '1 cup', grams: 175, kcal: 90, p: 1, c: 23, f: 0, usda: 'fruit salad fresh' },

  // ── Lunch & dinner ──────────────────────────────────────────────
  { aliases: ['salmon poke bowl'], emoji: '🍣', portion: '1 bowl', grams: 400, kcal: 580, p: 32, c: 68, f: 18, usda: 'poke bowl salmon' },
  { aliases: ['poke bowl', 'tuna poke bowl', 'poke'], emoji: '🍣', portion: '1 bowl', grams: 400, kcal: 550, p: 30, c: 65, f: 17, usda: 'poke bowl tuna' },
  { aliases: ['sushi roll', 'sushi', 'california roll'], emoji: '🍣', portion: '8 pieces', grams: 250, kcal: 350, p: 9, c: 64, f: 7, usda: 'sushi roll' },
  { aliases: ['chicken shawarma wrap', 'shawarma wrap', 'shawarma'], emoji: '🌯', portion: '1 wrap', grams: 280, kcal: 560, p: 32, c: 50, f: 25, usda: 'chicken shawarma wrap' },
  { aliases: ['burrito bowl'], emoji: '🥗', portion: '1 bowl', grams: 500, kcal: 700, p: 35, c: 75, f: 28, usda: 'burrito bowl chicken' },
  { aliases: ['burrito'], emoji: '🌯', portion: '1 burrito', grams: 380, kcal: 680, p: 28, c: 84, f: 26, usda: 'burrito with chicken' },
  { aliases: ['tacos', 'taco'], emoji: '🌮', portion: '2 tacos', grams: 200, kcal: 380, p: 18, c: 32, f: 19, usda: 'taco with meat' },
  { aliases: ['quesadilla'], emoji: '🫓', portion: '1 quesadilla', grams: 180, kcal: 470, p: 20, c: 38, f: 26, usda: 'quesadilla with chicken' },
  { aliases: ['grilled chicken salad', 'chicken salad'], emoji: '🥗', portion: '1 bowl', grams: 350, kcal: 380, p: 35, c: 12, f: 21, usda: 'chicken salad with greens' },
  { aliases: ['caesar salad'], emoji: '🥗', portion: '1 bowl', grams: 300, kcal: 360, p: 10, c: 14, f: 29, usda: 'caesar salad' },
  { aliases: ['cobb salad'], emoji: '🥗', portion: '1 bowl', grams: 350, kcal: 480, p: 30, c: 10, f: 35, usda: 'cobb salad' },
  { aliases: ['side salad', 'green salad', 'garden salad', 'salad'], emoji: '🥗', portion: '1 side bowl', grams: 100, kcal: 70, p: 2, c: 6, f: 5, usda: 'garden salad with dressing' },
  { aliases: ['grilled chicken', 'chicken breast'], emoji: '🍗', portion: '6 oz, grilled', grams: 170, kcal: 280, p: 53, c: 0, f: 6, usda: 'chicken breast grilled' },
  { aliases: ['chicken wings', 'wings'], emoji: '🍗', portion: '6 wings', grams: 180, kcal: 430, p: 36, c: 1, f: 30, usda: 'chicken wings' },
  { aliases: ['chicken nuggets', 'nuggets'], emoji: '🍗', portion: '6 pieces', grams: 96, kcal: 280, p: 13, c: 18, f: 17, usda: 'chicken nuggets' },
  { aliases: ['fried chicken'], emoji: '🍗', portion: '1 breast, fried', grams: 140, kcal: 360, p: 35, c: 13, f: 18, usda: 'chicken fried breast' },
  { aliases: ['grilled salmon', 'salmon'], emoji: '🐟', portion: '6 oz fillet', grams: 170, kcal: 350, p: 37, c: 0, f: 21, usda: 'salmon atlantic cooked' },
  { aliases: ['tuna'], emoji: '🐟', portion: '5 oz', grams: 140, kcal: 180, p: 40, c: 0, f: 1, usda: 'tuna cooked' },
  { aliases: ['shrimp'], emoji: '🦐', portion: '6 oz, cooked', grams: 170, kcal: 170, p: 34, c: 2, f: 2, usda: 'shrimp cooked' },
  { aliases: ['fish and chips'], emoji: '🐟', portion: '1 serving', grams: 400, kcal: 800, p: 35, c: 80, f: 38, usda: 'fish and chips' },
  { aliases: ['ribeye', 'rib eye', 'ribeye steak'], emoji: '🥩', portion: '12 oz ribeye', grams: 340, kcal: 880, p: 70, c: 0, f: 66, usda: 'beef ribeye steak cooked' },
  { aliases: ['filet mignon', 'filet', 'tenderloin'], emoji: '🥩', portion: '8 oz filet', grams: 227, kcal: 480, p: 56, c: 0, f: 27, usda: 'beef tenderloin cooked' },
  { aliases: ['ny strip', 'new york strip', 'strip steak'], emoji: '🥩', portion: '10 oz strip', grams: 283, kcal: 620, p: 64, c: 0, f: 39, usda: 'beef strip steak cooked' },
  { aliases: ['steak', 'sirloin'], emoji: '🥩', portion: '8 oz sirloin', grams: 227, kcal: 460, p: 60, c: 0, f: 23, usda: 'beef sirloin steak cooked' },
  { aliases: ['pork chop'], emoji: '🥩', portion: '1 chop', grams: 150, kcal: 290, p: 35, c: 0, f: 16, usda: 'pork chop cooked' },
  { aliases: ['cheeseburger'], emoji: '🍔', portion: '1 burger', grams: 200, kcal: 540, p: 27, c: 41, f: 29, usda: 'cheeseburger single patty' },
  { aliases: ['hamburger', 'burger'], emoji: '🍔', portion: '1 burger', grams: 180, kcal: 440, p: 23, c: 39, f: 21, usda: 'hamburger single patty' },
  { aliases: ['french fries', 'fries'], emoji: '🍟', portion: 'medium', grams: 117, kcal: 365, p: 4, c: 48, f: 17, usda: 'french fries' },
  { aliases: ['hot dog', 'hotdog'], emoji: '🌭', portion: '1 with bun', grams: 100, kcal: 290, p: 11, c: 24, f: 17, usda: 'hot dog with bun' },
  { aliases: ['pepperoni pizza', 'pizza'], emoji: '🍕', portion: '2 slices', grams: 214, kcal: 540, p: 23, c: 64, f: 21, usda: 'pizza cheese regular crust' },
  { aliases: ['spaghetti bolognese', 'spaghetti'], emoji: '🍝', portion: '1 plate', grams: 350, kcal: 520, p: 27, c: 58, f: 19, usda: 'spaghetti with meat sauce' },
  { aliases: ['mac and cheese', 'macaroni and cheese'], emoji: '🧀', portion: '1 cup', grams: 200, kcal: 380, p: 14, c: 38, f: 19, usda: 'macaroni and cheese' },
  { aliases: ['pasta', 'penne', 'fettuccine'], emoji: '🍝', portion: '1 cup with marinara', grams: 250, kcal: 320, p: 11, c: 58, f: 5, usda: 'pasta with tomato sauce' },
  { aliases: ['lasagna'], emoji: '🍝', portion: '1 piece', grams: 250, kcal: 410, p: 24, c: 38, f: 18, usda: 'lasagna with meat' },
  { aliases: ['steamed rice', 'white rice', 'rice'], emoji: '🍚', portion: '1 cup, cooked', grams: 158, kcal: 205, p: 4, c: 45, f: 0, usda: 'rice white cooked' },
  { aliases: ['brown rice'], emoji: '🍚', portion: '1 cup, cooked', grams: 195, kcal: 215, p: 5, c: 45, f: 2, usda: 'rice brown cooked' },
  { aliases: ['fried rice'], emoji: '🍚', portion: '1 cup', grams: 198, kcal: 330, p: 9, c: 42, f: 14, usda: 'fried rice' },
  { aliases: ['chicken curry', 'curry'], emoji: '🍛', portion: '1 plate with rice', grams: 400, kcal: 620, p: 30, c: 72, f: 22, usda: 'chicken curry with rice' },
  { aliases: ['ramen'], emoji: '🍜', portion: '1 bowl', grams: 500, kcal: 450, p: 18, c: 60, f: 15, usda: 'ramen noodle soup' },
  { aliases: ['pho'], emoji: '🍜', portion: '1 bowl', grams: 600, kcal: 420, p: 28, c: 55, f: 8, usda: 'pho beef noodle soup' },
  { aliases: ['pad thai'], emoji: '🍜', portion: '1 plate', grams: 350, kcal: 600, p: 22, c: 75, f: 23, usda: 'pad thai with chicken' },
  { aliases: ['chicken soup', 'chicken noodle soup', 'soup'], emoji: '🍲', portion: '1 bowl', grams: 350, kcal: 170, p: 12, c: 17, f: 5, usda: 'chicken noodle soup' },
  { aliases: ['tofu stir fry', 'stir fry'], emoji: '🥦', portion: '1 plate', grams: 300, kcal: 320, p: 18, c: 22, f: 18, usda: 'tofu vegetable stir fry' },
  { aliases: ['turkey sandwich'], emoji: '🥪', portion: '1 sandwich', grams: 230, kcal: 330, p: 22, c: 41, f: 9, usda: 'turkey sandwich' },
  { aliases: ['blt', 'blt sandwich'], emoji: '🥪', portion: '1 sandwich', grams: 180, kcal: 400, p: 16, c: 36, f: 21, usda: 'blt sandwich' },
  { aliases: ['grilled cheese'], emoji: '🥪', portion: '1 sandwich', grams: 120, kcal: 400, p: 14, c: 34, f: 23, usda: 'grilled cheese sandwich' },
  { aliases: ['peanut butter and jelly', 'pb&j', 'pbj', 'peanut butter sandwich'], emoji: '🥪', portion: '1 sandwich', grams: 100, kcal: 380, p: 12, c: 45, f: 17, usda: 'peanut butter and jelly sandwich' },
  { aliases: ['sandwich'], emoji: '🥪', portion: '1 sandwich', grams: 200, kcal: 350, p: 18, c: 40, f: 13, usda: 'sandwich deli meat' },

  // ── Sides & veg ─────────────────────────────────────────────────
  { aliases: ['mashed potatoes'], emoji: '🥔', portion: '1 cup', grams: 210, kcal: 240, p: 4, c: 35, f: 9, usda: 'mashed potatoes' },
  { aliases: ['baked potato'], emoji: '🥔', portion: '1 medium', grams: 173, kcal: 160, p: 4, c: 37, f: 0, usda: 'potato baked' },
  { aliases: ['sweet potato'], emoji: '🍠', portion: '1 medium, baked', grams: 150, kcal: 130, p: 2, c: 30, f: 0, usda: 'sweet potato baked' },
  { aliases: ['broccoli'], emoji: '🥦', portion: '1 cup, steamed', grams: 156, kcal: 55, p: 4, c: 11, f: 0, usda: 'broccoli cooked' },
  { aliases: ['edamame'], emoji: '🫛', portion: '1 cup, in pods', grams: 155, kcal: 188, p: 18, c: 14, f: 8, usda: 'edamame cooked' },
  { aliases: ['hummus with pita', 'hummus and pita', 'hummus'], emoji: '🫓', portion: 'snack plate', grams: 120, kcal: 270, p: 9, c: 38, f: 9, usda: 'hummus with pita bread' },

  // ── Snacks & sweets ─────────────────────────────────────────────
  { aliases: ['cottage cheese'], emoji: '🥛', portion: '1 cup', grams: 226, kcal: 180, p: 25, c: 8, f: 5, usda: 'cottage cheese lowfat' },
  { aliases: ['string cheese'], emoji: '🧀', portion: '1 stick', grams: 28, kcal: 80, p: 7, c: 1, f: 5, usda: 'cheese mozzarella string' },
  { aliases: ['cheese'], emoji: '🧀', portion: '1 oz cheddar', grams: 28, kcal: 115, p: 6, c: 0, f: 9, usda: 'cheese cheddar' },
  { aliases: ['almonds'], emoji: '🌰', portion: '1 oz (23 nuts)', grams: 28, kcal: 164, p: 6, c: 6, f: 14, usda: 'almonds raw' },
  { aliases: ['trail mix'], emoji: '🥜', portion: '1/4 cup', grams: 38, kcal: 175, p: 5, c: 15, f: 11, usda: 'trail mix' },
  { aliases: ['granola bar', 'protein bar'], emoji: '🍫', portion: '1 bar', grams: 40, kcal: 170, p: 4, c: 26, f: 6, usda: 'granola bar' },
  { aliases: ['potato chips', 'chips', 'crisps'], emoji: '🥔', portion: '1 oz bag', grams: 28, kcal: 150, p: 2, c: 15, f: 10, usda: 'potato chips' },
  { aliases: ['popcorn'], emoji: '🍿', portion: '3 cups, air-popped', grams: 24, kcal: 95, p: 3, c: 19, f: 1, usda: 'popcorn air-popped' },
  { aliases: ['dark chocolate', 'chocolate'], emoji: '🍫', portion: '1 oz', grams: 28, kcal: 170, p: 2, c: 13, f: 12, usda: 'chocolate dark' },
  { aliases: ['chocolate chip cookie', 'cookie', 'cookies'], emoji: '🍪', portion: '1 large', grams: 40, kcal: 190, p: 2, c: 26, f: 9, usda: 'cookie chocolate chip' },
  { aliases: ['brownie'], emoji: '🍫', portion: '1 square', grams: 56, kcal: 230, p: 3, c: 30, f: 11, usda: 'brownie' },
  { aliases: ['ice cream'], emoji: '🍨', portion: '1 cup, vanilla', grams: 132, kcal: 270, p: 5, c: 31, f: 15, usda: 'ice cream vanilla' },
  { aliases: ['glazed donut', 'donut', 'doughnut'], emoji: '🍩', portion: '1 glazed', grams: 60, kcal: 240, p: 3, c: 27, f: 13, usda: 'doughnut glazed' },
  { aliases: ['apple pie'], emoji: '🥧', portion: '1 slice', grams: 125, kcal: 300, p: 2, c: 43, f: 14, usda: 'apple pie' },
  { aliases: ['cheesecake'], emoji: '🍰', portion: '1 slice', grams: 100, kcal: 320, p: 6, c: 26, f: 22, usda: 'cheesecake' },
  { aliases: ['cake', 'birthday cake', 'chocolate cake'], emoji: '🍰', portion: '1 slice', grams: 95, kcal: 350, p: 4, c: 50, f: 15, usda: 'cake chocolate with frosting' },
];

// Number words the parser understands.
const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  couple: 2, few: 3, half: 0.5, 'a half': 0.5,
};

function normalize(s) {
  // Keep a decimal point (or comma) between digits so "2.5 cups" survives as
  // one number instead of becoming "2 5"; strip every other punctuation mark.
  return s.toLowerCase()
    .replace(/(\d)\s*,\s*(\d)/g, '$1.$2')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\.(?![0-9])/g, ' ')
    .replace(/(?<![0-9])\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Find the single best food for a name (used to enrich Gemini-parsed items).
function findFood(name) {
  const n = normalize(name);
  if (!n) return null;
  let best = null;
  for (const food of FOODS) {
    for (const alias of food.aliases) {
      if (n === alias) return food; // exact wins immediately
      if (n.includes(alias) || alias.includes(n)) {
        if (!best || alias.length > best.len) best = { food, len: alias.length };
      }
    }
  }
  return best ? best.food : null;
}

module.exports = { FOODS, NUMBER_WORDS, normalize, findFood };
