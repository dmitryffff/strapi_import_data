const csv = require('csv-parser')
const fs = require('fs')
const axios = require('axios').default;
const util = require('util');

const csvFilePath = process.argv[2];
const endpoint = process.argv[3];

const PROP_MATCHING_START_INDEX = 4;

const PROP_MATCHING_SEPARATOR = '=';
const RELATION_SEPARATOR = '*';
const IMAGE_SEPARATOR = '^';
const PROCESS_COLUMN_SEPARATORS = [RELATION_SEPARATOR, IMAGE_SEPARATOR];
const ARRAY_SEPARATOR = '; ';

const ADMIN_BEARER_TOKEN = "b44df3cb5b1a948651a722ce9e443864a8594c59ac1a2fedf9e2fa2baf19dbac4314bb3bdb91e6c63b83474bb0a9d7ef200548493d7dde429b2757642bbe4c0406ec6bf7c29ffba4182d3fff76f3d6f5929f9ebfca2860947c473e73060ed4b0c7c3f9c95d484f80612571064176ba3d4ca0dd088e276bc01ff53db38b1f9d08"

const strapiInstance = axios.create({
  baseURL: 'http://localhost:1337/api',
  headers: {
    'Content-Type': 'multipart/form-data',
    'Authorization': `Bearer ${ADMIN_BEARER_TOKEN}`
  }
});
strapiInstance.interceptors.request.use(
  v => {
    console.log('\x1b[31m', 'request', v.data)
    return v
  }
)
strapiInstance.interceptors.response.use(
  (v) => v,
  (c) => console.log(c.response?.data),
)


const relationData = {};

const getJsonFromCSV = async (csvPath) => {
  const res = [];

  const csvData = await parseCsvToJson(csvPath);

  await Promise.all(csvData.map(async (row) => {
    const jsonData = {};
    const jsonFormData = new FormData();
    const promises = [];

    for (let [jsonPropName, csvColumnName] of getProcessPropertiesMatching()) {
      const pureCsvColumnName = extractCsvColumnName(csvColumnName);

      switch(true) {
        case checkIsRelationField(csvColumnName):
          const relationArray = row[pureCsvColumnName];
          if (relationArray == undefined || relationArray === '') {
            break
          }
          promises.push(
            getRelationCellValue(csvColumnName, relationArray).then(data => {
              jsonData[jsonPropName] = data;
            })
          );            
          break;
        case checkIsImageField(csvColumnName):
          const imgUrl = row[pureCsvColumnName];
          promises.push(downloadImageBlobByUrl(imgUrl).then(({ file, fileName }) => {
            jsonFormData.append(`files.${jsonPropName}`, file, fileName);
          }));
          break;
        default:
          jsonData[jsonPropName] = handleValue(row[pureCsvColumnName]);
      }
    }

    await Promise.all(promises);
    jsonFormData.append('data', JSON.stringify(jsonData));
    res.push(jsonFormData);
  }));

  return res;
}

const main = async () => {
  const posts = await getJsonFromCSV(csvFilePath);

  console.log(util.inspect(posts, { showHidden: false, depth: null }));

  const res = await Promise.all(posts.map(
    entry => strapiInstance.post(endpoint, entry)
  ));

  console.log(`All ${endpoint} created`);
  console.log(res.map(r => r.data.data.attributes));
}

// start the script
main();

// some helper functions
async function fetchRelationData(endpointName) {
  return (await strapiInstance.get(endpointName)).data;
}

function findRelationId(endpointName, propName, value) {
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

function getProcessPropertiesMatching() {
  return process.argv
    .slice(PROP_MATCHING_START_INDEX)
    .map(arg => arg.split(PROP_MATCHING_SEPARATOR).map(i => i.trim()));
}

async function getRelationCellValue(csvColumnName, csvItemData) {
  const [endpointName, propName] = extractRelationEndpointAndPropName(csvColumnName);
  const cellData = separateArrayValues(csvItemData);
  
  if (!relationData[endpointName]) {
    await addRelationData(endpointName, relationData);
  }

  return cellData.map(value => findRelationId(
    endpointName,
    propName,
    value,
  ))
}

async function addRelationData(endpointName, relationData) {
  const fetchedRelationData = await fetchRelationData(endpointName);
  relationData[endpointName] = fetchedRelationData.data;
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

function downloadImageBlobByUrl(url) {
  return fetch(url)
    .then(async (res) => {
      const file = await res.blob();
      return {file, fileName: url.split('/').pop()}
    })
}

function handleValue(value) {
  return value === undefined || value === '' ? null : value
}
