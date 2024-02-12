const csv = require('csv-parser')
const fs = require('fs')

const csvFilePath = process.argv[2];
const endpoint = process.argv[3];

const PROP_MATCHING_START_INDEX = 4;

const PROP_MATCHING_SEPARATOR = '=';
const RELATION_SEPARATOR = '*';
const IMAGE_SEPARATOR = '^';
const PROCESS_COLUMN_SEPARATORS = [RELATION_SEPARATOR, IMAGE_SEPARATOR];
const ARRAY_SEPARATOR = '; ';
const EMPTY_STRING = '';

const ADMIN_BEARER_TOKEN = "847e745300668130a674f20e64e13ae4c63fb9d04c0871317b086cb8878d5c485ae61ecfd7ff68db783c335a743aeb6996ba3b6f5e03611fede85f248c13d0a955ab6ddae8dbfef98ca69e50d2736fb7aabe2531c1258503b0b314d7587721cc3fcf0ee5078279eb63e43957be545d4f85294c845a33e976045e5e0e69c2148e"

const relationData = {};

const getJsonFromCSV = async (csvPath) => {
  const res = [];

  const csvData = await parseCsvToJson(csvPath);

  csvData.forEach(row => {
    const jsonItemData = {};

    getProcessPropertiesMatching()
      .forEach(([jsonPropName, csvColumnName]) => {
        const pureCsvColumnName = extractCsvColumnName(csvColumnName);
        let jsonPropItemData = null;

        switch(true) {
          case checkIsRelationField(csvColumnName):
            const relationArray = row[pureCsvColumnName];
            getRelationCellValue(csvColumnName, relationArray)
              .then(data => jsonPropItemData = data);
            break;
          case checkIsImageField(csvColumnName):
            const imgUrl = row[pureCsvColumnName];
            jsonPropItemData = null;
            break;
          default:
            jsonPropItemData = row[pureCsvColumnName];
        }

        jsonItemData[jsonPropName] = jsonPropItemData;
      });

    res.push(jsonItemData);
  });

  return res;
}

const fetchCreateStrapiEntry = async (entry, endpoint) => {
  console.log({ data: entry });
  const response = await fetchStrapiApi(
    endpoint,
    'POST',
    JSON.stringify({ data: entry })
  );

  return response.json();
}

const main = async () => {
  const posts = await getJsonFromCSV(csvFilePath);
  console.log(posts);

  const res = await Promise.all(posts.slice(0, 5)
    .map(entry => fetchCreateStrapiEntry(entry, endpoint)));
  
  console.log(`All ${endpoint} created`);
  console.log(res);
}

// start the script
main();

// some helper functions
async function fetchRelationData(endpointName) {
  return (await fetchStrapiApi(endpointName)).json().data;
}

async function findRelationId(endpointName, propName, value) {
  return relationData[endpointName]
    .find(d => d.attributes[propName] === value).id
}

function checkIsRelationField(value) {
  return value.includes(RELATION_SEPARATOR);
}

function extractRelationEndpointAndPropName(value) {
  return value.split(RELATION_SEPARATOR)[1].split(':');
}

function checkIsImageField(value) {
  return value.includes(IMAGE_SEPARATOR);
}

function separateArrayValues(value) {
  return value.split(ARRAY_SEPARATOR).map(v => v.trim());
}

function fetchStrapiApi(endpoint, method = 'GET', body = null) {
  return fetch(`http://localhost:1337/api/${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_BEARER_TOKEN}`
    },
    method,
    body,
  });
}

function handleValue(value) {
  return (value !== undefined && value !== EMPTY_STRING) ? 
    value.trim().replace(/^"(.+)"$/, '$1') 
    : null;
}

function getProcessPropertiesMatching() {
  return process.argv
    .slice(PROP_MATCHING_START_INDEX)
    .map(arg => arg.split(PROP_MATCHING_SEPARATOR).map(i => i.trim()));
}

async function getRelationCellValue(csvColumnName, csvItemData) {
  const [endpointName, propName] = extractRelationEndpointAndPropName(csvColumnName);
  const cellData = separateArrayValues(csvItemData[csvColumnName]);
  
  if (!relationData[endpointName]) {
    await addRelationData(endpointName);
  }

  return {
    // to set relations: https://docs.strapi.io/dev-docs/api/rest/relations#set
    set: cellData.map(value => findRelationId(
      endpointName,
      propName,
      value,
    ))
  }
}

async function addRelationData(endpointName, relationData) {
  const fetchedRelationData = await fetchRelationData(endpointName);
  relationData[endpointName] = fetchedRelationData;
}

function parseCsvToJson(csvPath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => {
        resolve(results);
      })
      .on('error', reject);
  });
}

function extractCsvColumnName(processCsvColumnName) {
  let res = processCsvColumnName;
  PROCESS_COLUMN_SEPARATORS.forEach(separator => {
    if (res.includes(separator)) {
      res = res.split(separator)[0];
    }
  });
  return res;
}