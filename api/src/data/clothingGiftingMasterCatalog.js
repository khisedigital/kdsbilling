/**
 * Large practical master catalog for Clothing and Gifting business types.
 * Master products carry only: name, category, business type, price = 0.
 */

function buildClothing() {
  const categories = [
    { name: "Men's Shirts", products: [
      'Men Formal Shirt White', 'Men Formal Shirt Light Blue', 'Men Formal Shirt Pink',
      'Men Casual Shirt Checks', 'Men Casual Shirt Linen', 'Men Denim Shirt',
      'Men Slim Fit Shirt', 'Men Oxford Shirt', 'Men Mandarin Collar Shirt',
      'Men Party Wear Shirt', 'Men Half Sleeve Shirt', 'Men Flannel Shirt',
    ]},
    { name: "Men's T-Shirts", products: [
      'Men Round Neck T-Shirt', 'Men V-Neck T-Shirt', 'Men Polo T-Shirt',
      'Men Printed T-Shirt', 'Men Graphic T-Shirt', 'Men Solid Colour T-Shirt',
      'Men Oversized T-Shirt', 'Men Sports T-Shirt', 'Men Henley T-Shirt',
      'Men Full Sleeve T-Shirt', 'Men Collar T-Shirt', 'Men Cotton Blend T-Shirt',
    ]},
    { name: "Men's Jeans", products: [
      'Men Slim Fit Jeans', 'Men Regular Fit Jeans', 'Men Skinny Jeans',
      'Men Straight Fit Jeans', 'Men Distressed Jeans', 'Men Light Wash Jeans',
      'Men Dark Wash Jeans', 'Men Stretch Jeans', 'Men Cargo Jeans',
      'Men Bootcut Jeans', 'Men Black Jeans', 'Men Blue Mid Rise Jeans',
    ]},
    { name: "Men's Trousers", products: [
      'Men Formal Trouser Black', 'Men Formal Trouser Grey', 'Men Formal Trouser Navy',
      'Men Chinos Beige', 'Men Chinos Olive', 'Men Cotton Trouser',
      'Men Slim Fit Trouser', 'Men Pleated Trouser', 'Men Cargo Trouser',
      'Men Track Pant', 'Men Joggers', 'Men Linen Trouser',
    ]},
    { name: "Men's Formal Wear", products: [
      'Men Formal Suit Two Piece', 'Men Blazer Navy', 'Men Blazer Black',
      'Men Waistcoat', 'Men Formal Tie', 'Men Formal Belt Leather',
      'Men Dress Shirt Combo', 'Men Formal Shoe Black', 'Men Cufflinks Set',
    ]},
    { name: "Men's Casual Wear", products: [
      'Men Casual Jacket', 'Men Hoodie', 'Men Sweatshirt',
      'Men Casual Kurta', 'Men Lounge Set', 'Men Cargo Shorts',
      'Men Bermudas', 'Men Casual Cap', 'Men Casual Muffler',
    ]},
    { name: "Men's Shorts", products: [
      'Men Cotton Shorts', 'Men Denim Shorts', 'Men Sports Shorts',
      'Men Cargo Shorts Knee Length', 'Men Printed Shorts', 'Men Beach Shorts',
    ]},
    { name: "Men's Jackets", products: [
      'Men Bomber Jacket', 'Men Denim Jacket', 'Men Leather Look Jacket',
      'Men Windcheater', 'Men Puffer Jacket', 'Men Blouson Jacket',
      'Men Winter Coat', 'Men Softshell Jacket',
    ]},
    { name: "Men's Sweaters", products: [
      'Men Wool Sweater', 'Men Cardigan', 'Men Pullover Round Neck',
      'Men Turtle Neck Sweater', 'Men Cable Knit Sweater', 'Men Hooded Sweater',
    ]},
    { name: "Men's Innerwear", products: [
      'Men Cotton Vest', 'Men Brief Pack', 'Men Trunk Pack',
      'Men Boxer Shorts', 'Men Thermal Top', 'Men Thermal Bottom',
      'Men Socks Pack', 'Men Undershirt Pack',
    ]},
    { name: "Men's Ethnic Wear", products: [
      'Men Kurta White', 'Men Kurta Cotton Printed', 'Men Kurta Silk',
      'Men Pathani Suit', 'Men Sherwani', 'Men Nehru Jacket',
      'Men Dhoti Kurta Set', 'Men Ethnic Mojari', 'Men Indo Western Set',
    ]},
    { name: "Women's Sarees", products: [
      'Cotton Saree Plain', 'Cotton Saree Printed', 'Silk Saree Banarasi',
      'Georgette Saree', 'Chiffon Saree', 'Designer Party Saree',
      'Wedding Silk Saree', 'Linen Saree', 'Kantah Silk Saree',
      'Daily Wear Saree', 'Saree Blouse Piece', 'Saree Petticoat',
    ]},
    { name: "Women's Kurtis", products: [
      'Women Straight Kurti', 'Women A-Line Kurti', 'Women Anarkali Kurti',
      'Women Printed Kurti', 'Women Embroidery Kurti', 'Women Long Kurti',
      'Women Short Kurti', 'Women Cotton Kurti', 'Women Rayon Kurti',
      'Women Kurti Palazzo Set', 'Women Kurti Pant Set', 'Women Festive Kurti',
    ]},
    { name: "Women's Dresses", products: [
      'Women Maxi Dress', 'Women Midi Dress', 'Women A-Line Dress',
      'Women Party Dress', 'Women Bodycon Dress', 'Women Floral Dress',
      'Women Shirt Dress', 'Women Wrap Dress', 'Women Evening Gown',
      'Women Casual Frock', 'Women Shift Dress',
    ]},
    { name: "Women's Tops", products: [
      'Women Casual Top', 'Women Crop Top', 'Women Peplum Top',
      'Women Off Shoulder Top', 'Women Tank Top', 'Women Blouse Top',
      'Women Tunics', 'Women Lace Top', 'Women Knit Top',
      'Women Cold Shoulder Top',
    ]},
    { name: "Women's Shirts", products: [
      'Women Formal Shirt', 'Women Casual Shirt', 'Women Denim Shirt',
      'Women Check Shirt', 'Women Oversized Shirt', 'Women Linen Shirt',
    ]},
    { name: "Women's Jeans", products: [
      'Women Skinny Jeans', 'Women Mom Jeans', 'Women Straight Jeans',
      'Women High Rise Jeans', 'Women Boyfriend Jeans', 'Women Flare Jeans',
      'Women Black Jeans', 'Women Stretch Jeans', 'Women Capri Jeans',
    ]},
    { name: "Women's Leggings", products: [
      'Women Ankle Length Legging', 'Women Churidar Legging', 'Women Printed Legging',
      'Women Cotton Legging', 'Women Activewear Legging', 'Women Thermal Legging',
    ]},
    { name: "Women's Palazzos", products: [
      'Women Palazzo Plain', 'Women Palazzo Printed', 'Women Palazzo Wide Leg',
      'Women Sharara', 'Women Culottes', 'Women Palazzo With Kurti Set',
    ]},
    { name: "Women's Skirts", products: [
      'Women Pencil Skirt', 'Women A-Line Skirt', 'Women Maxi Skirt',
      'Women Pleated Skirt', 'Women Denim Skirt', 'Women Party Skirt',
    ]},
    { name: "Women's Ethnic Wear", products: [
      'Women Salwar Suit', 'Women Churidar Suit', 'Women Lehenga Choli',
      'Women Anarkali Suit', 'Women Gharara Set', 'Women Dupatta',
      'Women Ethnic Jacket', 'Women Festive Suit Set', 'Women Palazzo Suit',
    ]},
    { name: "Women's Nightwear", products: [
      'Women Night Suit', 'Women Nighty', 'Women Pyjama Set',
      'Women Sleep Shirt', 'Women Robe', 'Women Lounge Wear Set',
    ]},
    { name: "Women's Innerwear", products: [
      'Women Bra Soft Cup', 'Women Bra Padded', 'Women Camisole',
      'Women Panties Pack', 'Women Shapewear', 'Women Sports Bra',
      'Women Thermal Set', 'Women Slip',
    ]},
    { name: "Boys Wear", products: [
      'Boys T-Shirt', 'Boys Shirt', 'Boys Jeans', 'Boys Shorts',
      'Boys Tracksuit', 'Boys Hoodie', 'Boys Jacket', 'Boys Innerwear Pack',
      'Boys Kurta Pajama', 'Boys Casual Set',
    ]},
    { name: "Girls Wear", products: [
      'Girls Frock', 'Girls Top', 'Girls Leggings', 'Girls Jeans',
      'Girls Skirt', 'Girls Party Dress', 'Girls Kurti', 'Girls Night Suit',
      'Girls Jacket', 'Girls Ethnic Set',
    ]},
    { name: 'Kids School Wear', products: [
      'Boys School Shirt', 'Boys School Trouser', 'Girls School Shirt',
      'Girls School Skirt', 'School Tie', 'School Belt', 'School Socks Pack',
      'School Sweater', 'School Blazer',
    ]},
    { name: 'Kids Party Wear', products: [
      'Boys Party Shirt', 'Boys Party Blazer', 'Girls Party Frock',
      'Girls Party Lehenga', 'Kids Party Shoes', 'Kids Fancy Cap',
    ]},
    { name: 'Kids Ethnic Wear', products: [
      'Boys Kurta Set', 'Boys Sherwani Kids', 'Girls Lehenga Kids',
      'Girls Salwar Suit Kids', 'Kids Dupatta', 'Kids Mojari',
    ]},
    { name: 'Kids Nightwear', products: [
      'Boys Night Suit', 'Girls Night Suit', 'Kids Pyjama Set',
      'Kids Sleepwear Onesie',
    ]},
    { name: 'Traditional / Indian Wear', products: [
      'Cotton Dhoti', 'Silk Dhoti', 'Angavastram', 'Pheta Turban',
      'Women Cotton Dupatta', 'Women Banarasi Dupatta', 'Men Jutti',
      'Women Kolhapuri', 'Temple Jewellery Set Fashion',
    ]},
    { name: 'Western Wear', products: [
      'Women Blazer Western', 'Women Trouser Suit', 'Women Jumpsuit',
      'Men Western Formal Set', 'Women Coat Western', 'Women Trench Coat',
    ]},
    { name: 'Clothing Accessories', products: [
      'Leather Belt Men', 'Fashion Belt Women', 'Cotton Handkerchief Pack',
      'Wool Scarf', 'Winter Cap', 'Gloves Wool', 'Suspenders',
      'Pocket Square', 'Stole', 'Shawl',
    ]},
    { name: 'Fashion Accessories', products: [
      'Fashion Earrings Pair', 'Fashion Necklace', 'Bangle Set',
      'Bracelet Fashion', 'Hair Band Pack', 'Hair Clutch',
      'Sunglasses', 'Watch Fashion Analog', 'Brooch', 'Anklet Pair',
    ]},
  ];

  return { code: 'clothing', name: 'Clothing / Garments', description: 'Apparel, ethnic wear, western wear and fashion accessories', categories };
}

function buildGifting() {
  const categories = [
    { name: 'General Gifts', products: [
      'Photo Frame Medium', 'Photo Frame Large', 'Decorative Clock',
      'Scented Candle Set', 'Keychain Gift', 'Mug Gift Plain',
      'Wallet Gift Men', 'Handbag Mini Gift', 'Gift Card Holder',
      'Crystal Showpiece', 'Table Lamp Gift', 'Desk Organizer Gift',
    ]},
    { name: 'Personalized Gifts', products: [
      'Personalized Name Mug', 'Personalized Photo Frame', 'Personalized Keychain',
      'Custom Name Cushion', 'Engraved Pen Gift', 'Personalized Diary',
      'Custom Printed T-Shirt Gift', 'Name Plate Wooden', 'Personalized Calendar',
      'Custom Photo Lamp',
    ]},
    { name: 'Gift Hampers', products: [
      'Chocolate Gift Hamper', 'Dry Fruit Gift Hamper', 'Tea Coffee Hamper',
      'Spa Care Hamper', 'Festive Sweet Hamper', 'Gourmet Snack Hamper',
      'Baby Care Hamper', 'Corporate Welcome Hamper', 'Premium Combo Hamper',
      'Wellness Hamper',
    ]},
    { name: 'Toys', products: [
      'Soft Toy Teddy', 'Building Blocks Set', 'Remote Car Toy',
      'Doll Set', 'Puzzle Game', 'Board Game Family',
      'Educational Toy Kit', 'Action Figure', 'Plush Animal',
      'Musical Toy', 'Baby Rattle Set', 'Toy Kitchen Set',
    ]},
    { name: 'Home Décor Gifts', products: [
      'Wall Art Canvas', 'Decorative Vase', 'Indoor Plant Pot Gift',
      'Wind Chime', 'Wall Hangings Set', 'Table Centrepiece',
      'Fairy Lights String', 'Decorative Mirror Small', 'Idol Showpiece',
      'Candle Stand Metal', 'Throw Cushion Cover Set', 'Door Mat Designer',
    ]},
    { name: 'Wedding Gifts', products: [
      'Wedding Return Gift Box', 'Silver Plated Bowl Set', 'Couple Photo Frame',
      'Wedding Hamper Premium', 'Decorative Tray Gift', 'Puja Thali Gift Set',
      'Couple Mug Set', 'Wedding Candle Pair', 'Dry Fruit Wedding Box',
      'Blessing Idol Gift',
    ]},
    { name: 'Birthday Gifts', products: [
      'Birthday Balloon Pack', 'Birthday Mug Fun', 'Birthday Soft Toy',
      'Birthday Chocolate Box', 'Birthday Photo Album', 'Birthday Cap Gift',
      'Birthday Party Poppers Pack', 'Birthday Greeting Card Pack',
      'Kids Birthday Gift Set', 'Teen Birthday Combo',
    ]},
    { name: 'Anniversary Gifts', products: [
      'Anniversary Photo Frame', 'Couple Pendant Set', 'Anniversary Candle Set',
      'Love Message Mug Pair', 'Anniversary Hamper', 'Rose Bouquet Artificial',
      'Anniversary Cushion Pair', 'Keepsake Box',
    ]},
    { name: 'Corporate Gifts', products: [
      'Corporate Pen Set', 'Branded Notebook Gift', 'Desk Name Plate',
      'Power Bank Gift', 'USB Pendrive Gift', 'Corporate Diary Planner',
      'Laptop Sleeve Gift', 'Executive Gift Set', 'Desktop Calendar Branded',
      'Visit Card Holder Leather',
    ]},
    { name: 'Festival Gifts', products: [
      'Diwali Gift Pack', 'Holi Colour Gift Set', 'Rakhi Gift Pack',
      'Christmas Gift Stocking', 'Eid Gift Box', 'Navratri Gift Pack',
      'Pongal Gift Set', 'New Year Gift Hamper', 'Karva Chauth Gift Tray',
      'Ganesh Chaturthi Idol Gift',
    ]},
    { name: 'Decorative Items', products: [
      'Artificial Flower Bouquet', 'Decorative Bowl', 'Glass Showpiece',
      'Metal Craft Item', 'Wooden Craft Decor', 'Wall Sticker Pack',
      'Toran Door Hanging', 'Rangoli Stencil Set', 'Diya Set Decorative',
      'Incense Holder Gift',
    ]},
    { name: 'Stationery Gifts', products: [
      'Premium Pen Gift', 'Journal Notebook Leatherette', 'Colour Pencil Pack Gift',
      'Sketch Book Gift', 'Sticky Notes Gift Pack', 'Desk Organiser Stationery',
      'Fountain Pen Gift', 'Marker Set Gift', 'Geometry Box Gift',
      'Planner Undated Gift',
    ]},
    { name: 'Kids Gifts', products: [
      'Kids Art Kit', 'Kids Story Book Set', 'Kids Water Bottle Gift',
      'Kids School Bag Mini', 'Kids Colouring Book Pack', 'Kids Watch Fun',
      'Kids Cap Gift', 'Kids Lunch Box Gift', 'Kids Learning Tablet Toy',
      'Kids Craft Kit',
    ]},
    { name: 'Utility Gifts', products: [
      'Umbrella Gift', 'Travel Bottle Flask', 'Multi Tool Pocket Gift',
      'Phone Stand Gift', 'Cable Organiser Gift', 'Travel Pouch Set',
      'LED Torch Gift', 'Sewing Kit Mini', 'First Aid Pouch Gift',
      'Reusable Shopping Bag Pack',
    ]},
    { name: 'Other Gifts', products: [
      'Greeting Card Assorted Pack', 'Gift Wrapping Paper Roll', 'Gift Ribbon Pack',
      'Gift Bag Medium', 'Gift Bag Large', 'Thank You Card Pack',
      'Souvenir Magnet Pack', 'Lucky Charm Gift', 'Aroma Diffuser Gift',
      'Essential Oil Gift Set',
    ]},
  ];

  return { code: 'gifting', name: 'Gifting', description: 'Gifts, hampers, toys, décor and festive gifting products', categories };
}

function flattenCatalog(typeDef) {
  const categories = [];
  const products = [];
  typeDef.categories.forEach((cat, catIndex) => {
    categories.push({
      name: cat.name,
      description: cat.name,
      sortOrder: catIndex + 1,
    });
    cat.products.forEach((productName, productIndex) => {
      products.push({
        name: productName,
        categoryName: cat.name,
        sellingPrice: 0,
        costPrice: 0,
        uomCode: 'pcs',
        sortOrder: productIndex + 1,
      });
    });
  });
  return {
    code: typeDef.code,
    name: typeDef.name,
    description: typeDef.description,
    categories,
    products,
  };
}

const CLOTHING = flattenCatalog(buildClothing());
const GIFTING = flattenCatalog(buildGifting());

module.exports = {
  BUSINESS_TYPE_CATALOGS: [CLOTHING, GIFTING],
  CLOTHING,
  GIFTING,
};
