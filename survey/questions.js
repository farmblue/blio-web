/* Kolhapur Food Survey: every question on the paper form, with the codes used in the Google Sheet.
   Answers are saved by their English value (o.v), so offline and online rows can be analysed together.
   `step` marks a question as part of the short online survey, in that step. */
(function () {
  var O = function (v, mr) { return { v: v, mr: mr }; };
  var SIZES = [O('1-2', '१-२'), O('3-4', '३-४'), O('5-6', '५-६'), O('7 or more', '७ किंवा जास्त')];
  var MATTER = [O('Price', 'किंमत'), O('Freshness', 'ताजेपणा'), O('Trust / known seller', 'विश्वास / ओळख'), O('Variety', 'विविधता'), O('Nearby', 'जवळ असणे (सोयीचे ठिकाण)'), O('Home delivery', 'घरपोच सेवा'), O('Other', 'इतर')];
  var WISH = [O('Freshness', 'ताजेपणा'), O('Price', 'किंमत'), O('Variety', 'विविधता'), O('Cleanliness', 'स्वच्छता'), O('Home delivery', 'घरपोच सेवा'), O('On-time / reliable service', 'वेळेवर / भरवशाची सेवा'), O('Other', 'इतर')];
  var SPEND = [O('Under 200', '₹२०० पेक्षा कमी'), O('200 to 500', '₹२०० ते ५००'), O('500 to 1000', '₹५०० ते १०००'), O('Over 1000', '₹१००० पेक्षा जास्त')];
  var SPEND2 = [O('Under 300', '₹३०० पेक्षा कमी'), O('300 to 600', '₹३०० ते ६००'), O('600 to 1000', '₹६०० ते १०००'), O('Over 1000', '₹१००० पेक्षा जास्त')];
  var TRY = [O('Yes, definitely', 'हो, नक्कीच'), O('Maybe, if price is right', 'कदाचित, किंमत योग्य असेल तर'), O('No, not interested', 'नाही, आवड नाही'), O('Never eaten, would like to try', 'कधी खाल्ले नाही, पण खाऊन पाहायला आवडेल')];
  var DAYS = [O('Monday', 'सोमवार'), O('Tuesday', 'मंगळवार'), O('Wednesday', 'बुधवार'), O('Thursday', 'गुरुवार'), O('Friday', 'शुक्रवार'), O('Saturday', 'शनिवार'), O('Sunday', 'रविवार'), O('No fixed day', 'असा ठराविक वार नाही')];
  var SERV = [O('Blinkit', 'ब्लिंकिट'), O('Swiggy Instamart', 'स्विगी इन्स्टामार्ट'), O('Other', 'इतर स्थानिक अ‍ॅप किंवा व्हॉट्सअ‍ॅप ग्रुप (नाव लिहा)'), O('None of these', 'यापैकी कोणतीही नाही')];
  var YMN = [O('Yes', 'हो'), O('Maybe', 'कदाचित'), O('No', 'नाही')];
  var EXTRA = [O('Same price', 'तेवढेच'), O('10-20% more', '१०-२०% जास्त'), O('20-30% more', '२०-३०% जास्त'), O('Not willing to pay more', 'जास्त पैसे द्यायला तयार नाही')];

  var Q = [
    { id: 'q1', sec: '0', t: 'text', step: 1, req: 1, mr: 'तुम्ही कोल्हापुरात कोणत्या भागात (परिसरात) राहता?', en: 'Which area of Kolhapur do you live in?', ph: 'उदा. राजारामपुरी / e.g. Rajarampuri' },
    { id: 'q2', sec: '0', t: 'one', step: 1, req: 1, mr: 'तुमच्या घरात एकूण किती माणसे आहेत?', en: 'How many people live in your home?', o: SIZES },
    { id: 'q3', sec: '0', t: 'one', step: 1, req: 1, mr: 'तुमच्या घरी मासे किंवा इतर मांसाहार खाल्ला जातो का?', en: 'Is fish or other non-veg food eaten at home?', o: [O('Yes', 'हो'), O('No', 'नाही')] },
    { id: 'q4', sec: 'A', t: 'one', step: 2, req: 1, mr: 'सध्या तुम्ही मासे कुठून घेता?', en: 'Where do you buy fish now?', o: [O('Local fish market / seller', 'स्थानिक मासळी बाजार / विक्रेता'), O('Supermarket', 'सुपरमार्केट'), O('Online app', 'ऑनलाइन अ‍ॅप'), O('Street cart / hawker', 'रस्त्यावरील गाडा / फेरीवाला'), O('Other', 'इतर')] },
    { id: 'q5', sec: 'A', t: 'text', step: 2, mr: 'मासे घेण्यासाठी तुम्ही सर्वात जास्त वेळा ज्या दुकानात, विक्रेत्याकडे किंवा अ‍ॅपवर जाता, त्याचे नाव काय?', en: 'Name of the shop, seller or app you buy fish from most often', ph: 'ऐच्छिक / optional' },
    { id: 'q6', sec: 'A', t: 'multi', step: 2, mr: 'तिथली कोणती गोष्ट तुम्हाला सर्वात जास्त आवडते?', en: 'What do you like most about it?', o: MATTER },
    { id: 'q7', sec: 'A', t: 'multi', step: 2, mr: 'तिथे आणखी काय चांगले असायला हवे, असे तुम्हाला वाटते?', en: 'What should be better there?', o: WISH },
    { id: 'q8', sec: 'A', t: 'one', mr: 'सध्या तुम्हाला मासे घरपोच मिळतात का?', en: 'Do you get fish delivered home now?', o: [O('Yes, always', 'हो, नेहमी'), O('Sometimes', 'कधीकधी'), O('No, I go and buy myself', 'नाही, मी स्वतः जाऊन आणतो')] },
    { id: 'q9', sec: 'A', t: 'one', step: 2, req: 1, mr: 'तुमच्या घरी आठवड्यातून किती वेळा मासे आणले / खाल्ले जातात?', en: 'How many times a week is fish bought or eaten at home?', o: [O('0 to 1', '० ते १ वेळा'), O('2-3', '२-३ वेळा'), O('4-5', '४-५ वेळा'), O('Daily', 'रोज')] },
    { id: 'q10', sec: 'A', t: 'one', mr: 'एकदा मासे घेण्यासाठी तुमचा साधारण किती खर्च येतो?', en: 'How much do you usually spend each time you buy fish?', o: SPEND },
    { id: 'q11', sec: 'A', t: 'one', step: 2, req: 1, mr: 'आठवड्याला तुमच्या घरी माशांवर एकूण किती खर्च होतो?', en: 'How much does your home spend on fish in a week?', o: SPEND },
    { id: 'q12', sec: 'A', t: 'multi', step: 2, mr: 'समुद्रातील (खाऱ्या पाण्यातील) कोणते मासे तुम्हाला जास्त आवडतात?', en: 'Which sea fish do you like most?', o: [O('Pomfret', 'पापलेट'), O('Surmai / Kingfish', 'सुरमई'), O('Bombil / Bombay duck', 'बोंबील'), O('Bangda / Mackerel', 'बांगडा'), O('Prawns', 'कोळंबी (झिंगे)'), O('Rawas / Indian salmon', 'रावस'), O('Crab', 'खेकडा'), O('Clams / shellfish', 'तिसऱ्या (शिंपले)'), O('Other', 'इतर')] },
    { id: 'q13', sec: 'A', t: 'multi', step: 2, mr: 'गोड्या पाण्यातील कोणते मासे तुम्हाला मिळतात किंवा आवडतात?', en: 'Which freshwater fish do you get or like?', o: [O('Rohu', 'रोहू'), O('Katla', 'कतला'), O('Mrigal', 'मृगळ'), O('Silver carp', 'सिल्व्हर कार्प'), O('Local river fish (e.g. Panchganga)', 'स्थानिक नदीतील मासे (उदा. पंचगंगा)'), O('Mangur / Shingti (catfish)', 'मांगूर / शिंगटी (कॅटफिश)'), O('Other', 'इतर')] },
    { id: 'q14', sec: 'A', t: 'one', step: 2, req: 1, mr: 'शेतात (तळ्यात) वाढवलेला मड क्रॅब — मोठा, भरपूर मांस असलेला खेकडा, ज्याला परदेशात मोठी मागणी आहे — तुम्हाला खाऊन पाहायला आवडेल का?', en: 'Farm-raised mud crab is a large, meaty crab in big demand abroad. Would you like to try it?', o: TRY },
    { id: 'q15', sec: 'A', t: 'one', step: 2, req: 1, mr: 'फार्ममध्ये वाढवलेला तिलापिया मासा — सौम्य चवीचा, कमी काट्यांचा गोड्या पाण्यातला मासा (काही ठिकाणी ‘चायनीज मासा’) — तुम्हाला खाऊन पाहायला आवडेल का?', en: 'Farm-raised tilapia is a mild, low-bone freshwater fish (sometimes called "Chinese fish"). Would you like to try it?', o: TRY },
    { id: 'q16', sec: 'A', t: 'one', step: 2, req: 1, mr: 'स्वच्छ करून, तुमच्या गरजेनुसार कापून दिलेले ताजे मासे घरपोच मिळाले, तर तुम्हाला आवडेल का?', en: 'Would you like fresh fish, cleaned and cut the way you want, delivered home?', o: [O('Yes, definitely', 'हो, नक्कीच'), O('Maybe', 'कदाचित'), O('No', 'नाही')] },
    { id: 'q17', sec: 'A', t: 'one', step: 2, req: 1, mr: 'या सोयीसाठी सध्याच्या भावापेक्षा तुम्ही किती जास्त पैसे द्यायला तयार असाल?', en: 'For that, how much more than today\'s price would you pay?', o: EXTRA },
    { id: 'q18', sec: 'A', t: 'multi', mr: 'आठवड्यातल्या कोणत्या वारी तुमच्या घरी मासे / मांसाहार खाल्ला जात नाही?', en: 'On which days is no fish or meat eaten at home?', o: DAYS },
    { id: 'q19', sec: 'A', t: 'multi', mr: 'वर्षातील कोणत्या सणांना किंवा काळात तुमच्या घरी मासे / मांसाहार खाल्ला जात नाही?', en: 'During which festivals or periods is no fish or meat eaten?', o: [O('Ekadashi', 'एकादशी'), O('Shravan month', 'श्रावण महिना'), O('Navratri', 'नवरात्र'), O('Ganeshotsav', 'गणेशोत्सवाचा काळ'), O('Diwali period', 'दिवाळीचा काळ'), O('No fixed festival', 'असा ठराविक सण नाही'), O('Other', 'इतर')] },
    { id: 'q20', sec: 'B', t: 'multi', step: 3, req: 1, mr: 'सध्या तुम्ही फळे आणि भाज्या कुठून घेता?', en: 'Where do you buy fruits and vegetables now?', o: [O('Local vendor / cart', 'स्थानिक विक्रेता / गाडा'), O('Wholesale market / mandi', 'घाऊक बाजार / मंडई'), O('Supermarket', 'सुपरमार्केट'), O('Online app', 'ऑनलाइन अ‍ॅप'), O('Other', 'इतर')] },
    { id: 'q21', sec: 'B', t: 'text', step: 3, mr: 'फळे-भाज्या घेण्यासाठी तुम्ही सर्वात जास्त वेळा ज्या दुकानात, विक्रेत्याकडे किंवा अ‍ॅपवर जाता, त्याचे नाव काय?', en: 'Name of the shop, seller or app you buy fruits and vegetables from most often', ph: 'ऐच्छिक / optional' },
    { id: 'q22', sec: 'B', t: 'multi', mr: 'तिथली कोणती गोष्ट तुम्हाला सर्वात जास्त आवडते?', en: 'What do you like most about it?', o: MATTER },
    { id: 'q23', sec: 'B', t: 'multi', step: 3, mr: 'तिथे आणखी काय चांगले असायला हवे, असे तुम्हाला वाटते?', en: 'What should be better there?', o: WISH },
    { id: 'q24', sec: 'B', t: 'one', mr: 'सध्या तुम्हाला ‘सेंद्रिय (ऑर्गॅनिक)’ म्हणून विकली जाणारी फळे-भाज्या मिळतात का?', en: 'Do you get fruits and vegetables sold as organic now?', o: [O('Yes', 'हो'), O('No', 'नाही'), O("Don't know", 'माहीत नाही')] },
    { id: 'q25', sec: 'B', t: 'one', mr: '(हो असल्यास) ती किती ताजी आणि चांगल्या दर्जाची असतात?', en: 'If yes: how fresh and good are they?', o: [O('Very fresh', 'खूप ताजी'), O('Somewhat fresh', 'थोडी ताजी'), O('Not fresh', 'ताजी नसतात')] },
    { id: 'q26', sec: 'B', t: 'one', mr: 'त्या फळे-भाज्यांसाठी तुम्ही सध्या आठवड्याला किती पैसे देता?', en: 'How much do you spend on organic fruits and vegetables a week?', o: SPEND2 },
    { id: 'q27', sec: 'B', t: 'one', step: 3, req: 1, mr: 'तुमच्या घरी आठवड्याला फळे आणि भाज्यांवर एकूण किती खर्च होतो?', en: 'How much does your home spend on fruits and vegetables in a week?', o: SPEND2 },
    { id: 'q28', sec: 'B', t: 'one', mr: 'आठवड्यातून किती वेळा तुम्ही ताज्या भाज्या घेता?', en: 'How many times a week do you buy fresh vegetables?', o: [O('1-2 times', '१-२ वेळा'), O('3-4 times', '३-४ वेळा'), O('5 or more times', '५ किंवा जास्त वेळा'), O('Daily', 'रोज')] },
    { id: 'q29', sec: 'B', t: 'one', step: 3, req: 1, mr: 'सेंद्रिय पद्धतीने पिकवलेली ताजी फळे-भाज्या मिळाल्या, तर त्या घ्यायला तुम्हाला आवडेल का?', en: 'Would you buy fresh, organically grown fruits and vegetables?', o: YMN },
    { id: 'q30', sec: 'B', t: 'one', mr: 'खात्रीशीर ताज्या, सेंद्रिय फळे-भाज्यांसाठी तुम्ही किती जास्त पैसे द्यायला तयार असाल?', en: 'How much more would you pay for guaranteed fresh organic produce?', o: EXTRA },
    { id: 'q31', sec: 'C', t: 'multi', mr: 'कोल्हापुरातील खालीलपैकी कोणत्या घरपोच सेवांबद्दल तुम्ही ऐकले आहे?', en: 'Which of these delivery services in Kolhapur have you heard of?', o: SERV },
    { id: 'q32', sec: 'C', t: 'multi', step: 4, req: 1, mr: 'यापैकी कोणत्या सेवेवरून तुम्ही प्रत्यक्ष किमान एकदा तरी ऑर्डर केली आहे?', en: 'Which of these have you actually ordered from at least once?', o: SERV },
    { id: 'q33', sec: 'C', t: 'one', step: 4, mr: 'यापैकी एखादी सेवा वापरली असेल, तर ती तुम्ही अजूनही नियमितपणे वापरता का?', en: 'If you have used one, do you still use it regularly?', o: [O('Yes, regularly', 'हो, नियमितपणे'), O('Sometimes', 'कधीकधी'), O('No, stopped using', 'नाही, वापरणे बंद केले'), O('Never used any of them', 'यापैकी कोणतीही कधीच वापरली नाही')] },
    { id: 'q34', sec: 'C', t: 'text', ml: 1, step: 4, mr: 'तुम्ही ती सेवा वापरणे बंद केले असेल किंवा क्वचितच वापरत असाल, तर त्याचे कारण काय?', en: 'If you stopped or rarely use it, why?', ph: 'ऐच्छिक / optional' },
    { id: 'q35', sec: 'C', t: 'one', mr: 'एकंदरीत, कोल्हापुरात ताजे मासे आणि फळे-भाज्या मिळण्याच्या सध्याच्या सोयींबद्दल तुम्ही किती समाधानी आहात?', en: 'Overall, how satisfied are you with getting fresh fish, fruits and vegetables in Kolhapur?', o: [O('1 - Not at all satisfied', '१ — अजिबात समाधानी नाही'), O('2 - Not satisfied', '२ — समाधानी नाही'), O('3 - OK', '३ — ठीक आहे'), O('4 - Satisfied', '४ — समाधानी'), O('5 - Very satisfied', '५ — खूप समाधानी')] },
    { id: 'q36', sec: 'D', t: 'one', mr: 'सध्या तुम्हाला किराणा किंवा खाण्याचे पदार्थ घरपोच मिळतात का?', en: 'Do you get groceries or food delivered home now?', o: [O('Regularly', 'नियमितपणे'), O('Sometimes', 'कधीकधी'), O('Never', 'कधीच नाही')] },
    { id: 'q37', sec: 'D', t: 'one', step: 4, req: 1, mr: 'ताजे मासे आणि / किंवा फळे-भाज्या मागवण्यासाठी खास मोबाईल अ‍ॅप वापरायला तुम्हाला आवडेल का?', en: 'Would you use a mobile app to order fresh fish and/or fruits and vegetables?', o: YMN },
    { id: 'q38', sec: 'D', t: 'one', step: 4, req: 1, mr: 'प्रत्येक वेळी वेगळी ऑर्डर देण्याऐवजी साप्ताहिक किंवा मासिक योजना (ठरलेल्या वस्तू नियमितपणे घरपोच) तुम्हाला आवडेल का?', en: 'Instead of ordering each time, would you like a weekly or monthly plan (fixed items delivered regularly)?', o: [O('Weekly plan', 'साप्ताहिक योजना'), O('Monthly plan', 'मासिक योजना'), O('Only occasional separate orders', 'फक्त वेळोवेळी स्वतंत्र ऑर्डर'), O('Not interested', 'रस नाही')] },
    { id: 'q39', sec: 'D', t: 'one', mr: 'अशी योजना असेल, तर तुम्हाला कशात सर्वात जास्त रस असेल?', en: 'If there were such a plan, what would interest you most?', o: [O('Only fish', 'फक्त मासे'), O('Only fruits & vegetables', 'फक्त फळे-भाज्या'), O('Both together', 'दोन्ही मिळून'), O('Ready-to-cook meals also', 'तयार जेवणसुद्धा')] },
    { id: 'q40', sec: 'D', t: 'one', mr: 'घरपोच सेवेसाठी कोणती वेळ तुम्हाला सोयीची आहे?', en: 'What time suits you for delivery?', o: [O('Morning', 'सकाळ'), O('Afternoon', 'दुपार'), O('Evening', 'संध्याकाळ'), O('Any time', 'कोणतीही वेळ चालेल')] },
    { id: 'q41', sec: 'D', t: 'one', mr: 'पैसे देण्यासाठी तुम्ही कोणती पद्धत पसंत कराल?', en: 'How would you prefer to pay?', o: [O('UPI', 'UPI'), O('Cash on delivery', 'डिलिव्हरीच्या वेळी रोख'), O('Card', 'कार्ड'), O('Other', 'इतर')] },
    { id: 'q42', sec: 'E', t: 'one', step: 1, req: 1, mr: 'तुमचा वयोगट कोणता?', en: 'Your age group', o: [O('Under 25', '२५ पेक्षा कमी'), O('25-34', '२५-३४'), O('35-44', '३५-४४'), O('45-54', '४५-५४'), O('55 or more', '५५ किंवा जास्त')] },
    { id: 'q43', sec: 'E', t: 'text', mr: 'तुमचे नाव (ऐच्छिक)', en: 'Name (optional)' },
    { id: 'q44', sec: 'E', t: 'text', mr: 'तुमचा मोबाईल क्रमांक (ऐच्छिक)', en: 'Mobile number (optional)' },
    { id: 'q45', sec: 'E', t: 'text', ml: 1, step: 4, mr: 'ताजे अन्न घरपोच देणाऱ्या सेवेकडून तुम्हाला आणखी काय अपेक्षित आहे?', en: 'What else would you want from a fresh-food delivery service?', ph: 'ऐच्छिक / optional' },
    { id: 'q46', sec: 'E', t: 'one', mr: 'तुमचा व्यवसाय / नोकरी कोणती?', en: 'Occupation', o: [O('Private job', 'खाजगी नोकरी'), O('Government job', 'सरकारी नोकरी'), O('Own business / self-employed', 'स्वतःचा व्यवसाय / स्वयंरोजगार'), O('Professional (doctor, lawyer, engineer, CA etc.)', 'व्यावसायिक (डॉक्टर, वकील, इंजिनिअर, सी.ए. इ.)'), O('Farmer / farming', 'शेतकरी / शेती'), O('Homemaker', 'गृहिणी'), O('Student', 'विद्यार्थी'), O('Retired', 'निवृत्त'), O('Other', 'इतर')] },
    { id: 'q47', sec: 'E', t: 'one', mr: 'तुमचे सर्वाधिक शिक्षण किती झाले आहे?', en: 'Highest education', o: [O('10th or below', '१०वी किंवा त्यापेक्षा कमी'), O('12th', '१२वी'), O('Diploma / ITI', 'डिप्लोमा / आयटीआय'), O('Graduate', 'पदवीधर'), O('Postgraduate', 'पदव्युत्तर'), O('Professional degree (MBBS, engineering, CA, law etc.)', 'व्यावसायिक पदवी (एमबीबीएस, इंजिनिअरिंग, सी.ए., कायदा इ.)'), O('Other', 'इतर')] }
  ];

  var SECS = {
    '0': ['विभाग 0 — तुमच्या कुटुंबाविषयी', 'Section 0 — About your family'],
    'A': ['विभाग अ — मासे खरेदीच्या सवयी', 'Section A — Fish (only if Q3 is Yes)'],
    'B': ['विभाग ब — फळे आणि भाज्या', 'Section B — Fruits and vegetables'],
    'C': ['विभाग क — सध्याच्या घरपोच सेवा', 'Section C — Current delivery services'],
    'D': ['विभाग ड — घरपोच सेवा आणि अ‍ॅपबद्दल आवड', 'Section D — Interest in delivery and an app'],
    'E': ['विभाग ड — तुमच्याबद्दल थोडेसे', 'About the respondent (printed as another “विभाग ड”)']
  };

  window.SURVEY = { Q: Q, SECS: SECS, SKIP_IF_NO: Q.filter(function (q) { return q.sec === 'A'; }).map(function (q) { return q.id; }) };
})();
