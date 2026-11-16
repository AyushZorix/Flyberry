// Place suggestions for the From / To boxes: [name, code(s) sent to the search].
// Codes can be one airport, a city code covering all its airports (LON, NYC),
// or a comma-separated list. Anything not listed here is sent as typed and
// resolved by the flight service.
export const AIRPORTS = [
  // India
  ['Delhi', 'DEL'], ['Mumbai', 'BOM'], ['Bengaluru', 'BLR'], ['Hyderabad', 'HYD'],
  ['Chennai', 'MAA'], ['Kolkata', 'CCU'], ['Goa', 'GOI,GOX'], ['Pune', 'PNQ'],
  ['Ahmedabad', 'AMD'], ['Jaipur', 'JAI'], ['Kochi', 'COK'], ['Lucknow', 'LKO'],
  ['Chandigarh', 'IXC'], ['Guwahati', 'GAU'], ['Varanasi', 'VNS'], ['Patna', 'PAT'],
  ['Bhubaneswar', 'BBI'], ['Indore', 'IDR'], ['Nagpur', 'NAG'], ['Srinagar', 'SXR'],
  ['Amritsar', 'ATQ'], ['Thiruvananthapuram', 'TRV'], ['Kozhikode', 'CCJ'], ['Kannur', 'CNN'],
  ['Coimbatore', 'CJB'], ['Madurai', 'IXM'], ['Tiruchirappalli', 'TRZ'], ['Mangaluru', 'IXE'],
  ['Visakhapatnam', 'VTZ'], ['Vijayawada', 'VGA'], ['Tirupati', 'TIR'], ['Raipur', 'RPR'],
  ['Ranchi', 'IXR'], ['Bhopal', 'BHO'], ['Udaipur', 'UDR'], ['Jodhpur', 'JDH'],
  ['Dehradun', 'DED'], ['Leh', 'IXL'], ['Jammu', 'IXJ'], ['Bagdogra', 'IXB'],
  ['Port Blair', 'IXZ'], ['Surat', 'STV'], ['Vadodara', 'BDQ'], ['Rajkot', 'RAJ'],
  ['Agartala', 'IXA'], ['Imphal', 'IMF'], ['Dibrugarh', 'DIB'], ['Ayodhya', 'AYJ'],
  ['Prayagraj', 'IXD'], ['Gorakhpur', 'GOP'], ['Aurangabad', 'IXU'], ['Hubballi', 'HBX'],
  ['Mysuru', 'MYQ'], ['Shirdi', 'SAG'], ['Darbhanga', 'DBR'], ['Deoghar', 'DGH'],
  // Nearby and Middle East
  ['Kathmandu', 'KTM'], ['Colombo', 'CMB'], ['Dhaka', 'DAC'], ['Male', 'MLE'],
  ['Dubai', 'DXB'], ['Abu Dhabi', 'AUH'], ['Sharjah', 'SHJ'], ['Doha', 'DOH'],
  ['Muscat', 'MCT'], ['Kuwait', 'KWI'], ['Bahrain', 'BAH'], ['Riyadh', 'RUH'],
  ['Jeddah', 'JED'], ['Dammam', 'DMM'], ['Istanbul', 'IST'], ['Tel Aviv', 'TLV'],
  // Asia Pacific
  ['Singapore', 'SIN'], ['Bangkok', 'BKK'], ['Phuket', 'HKT'], ['Kuala Lumpur', 'KUL'],
  ['Bali', 'DPS'], ['Jakarta', 'JKT'], ['Hanoi', 'HAN'], ['Ho Chi Minh City', 'SGN'],
  ['Da Nang', 'DAD'], ['Manila', 'MNL'], ['Hong Kong', 'HKG'], ['Tokyo', 'TYO'],
  ['Osaka', 'OSA'], ['Seoul', 'SEL'], ['Taipei', 'TPE'], ['Beijing', 'BJS'],
  ['Shanghai', 'SHA'], ['Sydney', 'SYD'], ['Melbourne', 'MEL'], ['Brisbane', 'BNE'],
  ['Perth', 'PER'], ['Auckland', 'AKL'], ['Almaty', 'ALA'], ['Tashkent', 'TAS'],
  ['Baku', 'GYD'], ['Tbilisi', 'TBS'],
  // Europe
  ['London', 'LON'], ['Paris', 'PAR'], ['Amsterdam', 'AMS'], ['Frankfurt', 'FRA'],
  ['Munich', 'MUC'], ['Berlin', 'BER'], ['Zurich', 'ZRH'], ['Geneva', 'GVA'],
  ['Rome', 'ROM'], ['Milan', 'MIL'], ['Venice', 'VCE'], ['Madrid', 'MAD'],
  ['Barcelona', 'BCN'], ['Lisbon', 'LIS'], ['Vienna', 'VIE'], ['Prague', 'PRG'],
  ['Budapest', 'BUD'], ['Brussels', 'BRU'], ['Copenhagen', 'CPH'], ['Stockholm', 'STO'],
  ['Oslo', 'OSL'], ['Helsinki', 'HEL'], ['Dublin', 'DUB'], ['Manchester', 'MAN'],
  ['Edinburgh', 'EDI'], ['Birmingham', 'BHX'], ['Athens', 'ATH'], ['Warsaw', 'WAW'],
  ['Moscow', 'MOW'],
  // Americas and Africa
  ['New York', 'NYC'], ['Los Angeles', 'LAX'], ['San Francisco', 'SFO'], ['Chicago', 'CHI'],
  ['Boston', 'BOS'], ['Washington', 'WAS'], ['Seattle', 'SEA'], ['Dallas', 'DFW'],
  ['Houston', 'HOU'], ['Atlanta', 'ATL'], ['Miami', 'MIA'], ['Toronto', 'YTO'],
  ['Vancouver', 'YVR'], ['Montreal', 'YMQ'], ['Mexico City', 'MEX'], ['Sao Paulo', 'SAO'],
  ['Cairo', 'CAI'], ['Nairobi', 'NBO'], ['Johannesburg', 'JNB'], ['Cape Town', 'CPT'],
  ['Addis Ababa', 'ADD'], ['Mauritius', 'MRU'], ['Seychelles', 'SEZ'],
];

// Common alternative names people type.
const ALIASES = {
  'new delhi': 'DEL', bombay: 'BOM', bangalore: 'BLR', calcutta: 'CCU', madras: 'MAA',
  cochin: 'COK', trivandrum: 'TRV', calicut: 'CCJ', mangalore: 'IXE', vizag: 'VTZ',
  trichy: 'TRZ', allahabad: 'IXD', mysore: 'MYQ', hubli: 'HBX', baroda: 'BDQ',
  siliguri: 'IXB', andaman: 'IXZ', maldives: 'MLE', nyc: 'NYC', saigon: 'SGN',
  'ho chi minh': 'SGN', denpasar: 'DPS', 'washington dc': 'WAS',
};

const BY_NAME = new Map(AIRPORTS.map(([name, code]) => [name.toLowerCase(), code]));
const CODE_IN_LABEL = /\(([A-Z]{3}(?:,[A-Z]{3})*)\)\s*$/;

export const placeLabel = ([name, code]) => `${name} (${code})`;

/** Turn what the user typed or picked into the value sent to the search. */
export function resolvePlace(input) {
  const text = (input || '').trim();
  const picked = text.match(CODE_IN_LABEL);
  if (picked) return picked[1];
  const key = text.toLowerCase();
  return BY_NAME.get(key) || ALIASES[key] || text;
}
