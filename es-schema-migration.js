const co = require('bluebird-co').co;
const elasticsearch = require('elasticsearch');
const fs = require('co-fs');
const path = require('path');
const colors = require('colors');
const api = module.exports = {};

let client;

api.elasticsearch = function(options) {
  client = new elasticsearch.Client(options);
  return client;
}

api.indexExists = function(index) {
  return new Promise((resolve, reject) => {
    client.indices.get({ index })
      .then(resp => {
        resolve(true);
      })
      .catch(err => {
        resolve(false);
      })
  });
}

api.createIndex = function(index, body) {
  return client.indices.create({
    index,
    body
  });
}

api.putMapping = function(index, body, options) {
  options || (options = {});
  var params = {
    index,
    body,
    type: null
  };

  Object.assign(params, options);

  return client.indices.putMapping(params)
    .then(response => {
      resolve(response);
    });
}

api.deleteIndex = function(index) {
  return client.indices.delete({ index })
}

api.createIndexWithMapping = function*(index, body, options) {
  var exists = yield api.indexExists(index);
  console.log('Index exists'.bold, (exists ? 'yes'.green : 'no'.red));

  if(exists) {
    if(options.deleteIndex) {
      console.log('Going to delete index'.bold, index.cyan);
      var deleteResponse = yield api.deleteIndex(index);
      console.log(colors.gray(JSON.stringify(deleteResponse)));
      console.log('✔️ done'.green);
    } else {
      console.log();
      console.error('Index'.red, index, 'already exists!'.red);
      process.exit(1);
    }
  }

  console.log()
  console.log('Creating index'.bold, index.cyan, 'with mapping...'.bold);
  var response = yield api.createIndex(index, body);
  console.log(colors.gray(JSON.stringify(response)));
  console.log('✔️ done'.green);

  return response;
}

api.putAlias = function(aliasName, indexName) {
  var params = {
    index: indexName,
    name: aliasName
  };

  return client.indices.putAlias(params);
}

api.reindexFrom = function(fromIndex, toIndex) {
  var body = {
    source: {
      index: fromIndex
    },
    dest: {
      index: toIndex
    }
  }

  return client.reindex({
    body,
    waitForCompletion: true,
    refresh: true
  });
}

api.checkConnection = function() {
  return client.cluster.health({ timeout: '2s' });
}


var options = require('yargs')
  .usage('Usage: $0 <command> [options]')
  .command('schema', 'Migrate index mapping to new version', y => {
    return y
      .usage('Usage: $0 schema [options]')
      .option('add-alias', { description: 'Add alias after reindexing' })
      .option('alias', { description: 'Alias to use, defaults to auto generated name.' });
  })
  .option('prefix').demand('prefix')
  .option('index').demand('index')
  .option('version').demand('version')
  .option('host', { default: 'http://localhost:9200' })
  .boolean(['delete-existing', 'add-alias'])


  .describe('prefix', 'Prefix to be used in index names.')
  .describe('index', 'Name of the index.')
  .describe('version', 'Version to migrate to.')

  .describe('host', 'Elasticsearch URL')
  .describe('delete-existing', 'Delete existing versioned index, if exists.')

  .describe('from', 'Reindex data from specified index')
  .describe('from-previous', 'Reindex data from previous version')
  .help()
  .argv;


if(!module.parent) {
  co(function*(){
      const esOptions = {};
      esOptions.hosts = options.host;

      api.elasticsearch(esOptions);

      const basePath = options['base-path'] || path.join(__dirname); 
      const prefix = options.prefix;
      const index = options.index;
      const version = options.version;
      const indexName = `${prefix}-${index}_v${version}`
      const indexAliasName = `${prefix}-${index}`

      const command = options._[0];

      // load mapping with proper version
      let mappingPath = path.join(basePath, 'mappings');

      try {
        yield fs.stat(mappingPath);
      } catch(err) {
        throw new Error(`mappings directory not found under base path: ${basePath}`);
      }

      console.log();
      console.log('Checking ES connection to'.bold, String(esOptions.hosts).cyan)
      console.log(colors.gray(JSON.stringify(yield api.checkConnection())));
      console.log('✔️ ok'.green);

      switch(command) {
        case 'schema':
          console.log('');

          // read mapping
          var mappingBuffer = yield fs.readFile(path.join(mappingPath, `${indexName}.json`));
          var jsonMapping = JSON.parse(mappingBuffer);

          if(Object.keys(jsonMapping).indexOf('mappings') < 0) {
            throw new Error('No mappings-field found from mapping. Check the contents');
          }

          //console.log(JSON.stringify(mapping, true, 2));

          // FIXME: maybe diff the mapping here?

          var response = yield api.createIndexWithMapping(indexName, jsonMapping, {
            deleteIndex: options['delete-existing']
          });

          if(options.from || options['from-previous']) {
            var fromIndex = options.from;

            if(options['from-previous']) {
              fromIndex = `${prefix}-${index}_v${version-1}`
            }

            console.log();
            console.log('Reindexing from'.bold.white, fromIndex.cyan, '=>'.bold, indexName.cyan, '...'.bold);
            console.log(colors.gray(JSON.stringify(yield api.reindexFrom(fromIndex, indexName))));
            console.log('✔️ done'.green);
          }

          if(options['add-alias']) {
            console.log()
            console.log('Adding alias'.bold, indexAliasName.cyan, '=>'.bold, indexName.cyan);
            yield api.putAlias(indexAliasName, indexName);
            console.log('✔️ done'.green);
          }
          break;

        default:
          console.error('Unknown command:'.red, command);
          process.exit(1);
          break;
      }
    })
    .then(_ => {
      console.log()
    })
    .catch(err => {
      console.error('💣'.bold.red)
      console.log(colors.red(err.stack));
      process.exit(1);
    });
}

