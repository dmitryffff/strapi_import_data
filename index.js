const csv = require('csv-parser')
const fs = require('fs')
const axios = require('axios').default;
const util = require('util');
const { uuid } = require('uuidv4');
const TurndownService = require('turndown')

const csvFilePath = process.argv[2];
const endpoint = process.argv[3];

const COLOR = {
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
}

const PROP_MATCHING_START_INDEX = 4;

const PROP_MATCHING_SEPARATOR = '=';

const RELATION_SEPARATOR = '*';
const IMAGE_SEPARATOR = '^';
const MARKDOWN_SEPARATOR = '!';
const PROCESS_COLUMN_SEPARATORS = [
  RELATION_SEPARATOR,
  IMAGE_SEPARATOR,
    MARKDOWN_SEPARATOR,
];
const ARRAY_SEPARATOR = '; ';

const ADMIN_BEARER_TOKEN = "ce0f22cb789641f486e45a5af1a7cbffa3ef6e55bf630e38e3eb0e5e4ec24876d870c1586fc2ce6f8a4b48fdd05e00eb05a63aada90ac7df233ded3c1de5f2c9b73b9a7a9afc78078e3c603fd66e93006ce906b6d565c8980ab33543d244d991f35347dfc737b471ebad5acf699f752f1ed13c8f42cf8b16c7c98b8d1ea1b3f8"

const strapiInstance = axios.create({
  baseURL: 'http://localhost:1337/api',
  headers: {
    'Content-Type': 'multipart/form-data',
    'Authorization': `Bearer ${ADMIN_BEARER_TOKEN}`
  }
});
strapiInstance.interceptors.request.use(
  v => {
    console.log(COLOR.RED, 'request', v.url, v.data)
    return v
  }
)
strapiInstance.interceptors.response.use(
  (v) => v,
  (c) => console.log(c.response?.data),
)

const turndownService = new TurndownService({ headingStyle: "atx" })

const relationData = {};

const getJsonFromCSV = async (csvPath) => {
  await fillRelationData(getProcessPropertiesMatching());

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
          jsonData[jsonPropName] = getRelationCellValue(
            csvColumnName,
            relationArray,
          )
          break;
        case checkIsImageField(csvColumnName):
          const imgUrl = row[pureCsvColumnName];
          promises.push(downloadImageBlobByUrl(imgUrl).then(
            ({ file, fileName }) => jsonFormData.append(
              `files.${jsonPropName}`,
              file,
              fileName,
            )
          ));
          break;
        case checkIsMarkdownField(csvColumnName):
          jsonData[jsonPropName] = turndownService.turndown(row[pureCsvColumnName]);
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
  console.log(res.map(r => r?.data?.data?.attributes));
}

// start the script
main();

// some helper functions
async function fetchRelationData(endpointName) {
  const res = await strapiInstance.get(endpointName);
  return res?.data
}

function findRelationId(endpointName, propName, value) {
  return relationData[endpointName]
    ?.find(d => d.attributes[propName] === value)?.id;
}


function checkIsRelationField(value) {
  return value.includes(RELATION_SEPARATOR);
}

function checkIsMarkdownField(value) {
  return value.includes(MARKDOWN_SEPARATOR);
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

function getRelationCellValue(csvColumnName, csvItemData) {
  const [endpointName, propName] = extractRelationEndpointAndPropName(csvColumnName);
  const cellData = separateArrayValues(csvItemData);

  
  return cellData.map(value => findRelationId(
    endpointName,
    propName,
    value,
  )).filter(v => v !== undefined)
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
      return {
        file,
        fileName: getUniqueFileName(getFileExtensionFromUrl(url)),
      }
    })
}

function getUniqueFileName(ext) {
  const date = new Date();
  return `${date.toUTCString()}_${uuid()}.${ext}`;
}

function getFileExtensionFromUrl(url) {
  return url.split('.').pop();
}

function handleValue(value) {
  return value === undefined || value === '' ? null : value
}

async function fillRelationData(processPropsMatching) {
  const relativeEndpoints = processPropsMatching
    .map(p => p[1])
    .filter(p => checkIsRelationField(p))
    .map(p => extractRelationEndpointAndPropName(p)[0])
  const endpointsWithoutDuplicates = [...(new Set(relativeEndpoints))]

  await Promise.all(endpointsWithoutDuplicates.map(async (endpoint) => {
    const res = await fetchRelationData(endpoint);
    relationData[endpoint] = res.data;
  }));
}

