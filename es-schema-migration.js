const co = require('bluebird-co').co;
const elasticsearch = require('elasticsearch');
const fs = require('co-fs');
const path = require('path');
const colors = require('colors');
const api = module.exports = {};

let client;

var grayput = function(input) {
  if(typeof input === "object") {
    input = JSON.stringify(input);
  }

  return console.log(colors.gray(input));
}

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
      grayput(deleteResponse);
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
  grayput(response);
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

api.getAliases = function(aliasName) {
  return client.indices.getAlias({
    name: aliasName
  });
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


api.updateAliases = function(add, remove) {
  let actions = [];
  if(remove && Array.isArray(remove)) {
    remove.forEach(a => {
      actions.push({ remove: a });
    });
  }

  add.forEach(a => {
    actions.push({ add: a });
  });

  return client.indices.updateAliases({
    body: {
      actions
    }
  });
}

var handleAliasUpdate = function*(indexName, aliasName) {
  console.log();
  console.log('Getting aliases'.bold, aliasName.cyan);
  var aliases = yield api.getAliases(aliasName);
  grayput(aliases);
  console.log('✔️ done'.green);
  console.log();

  let add = [];
  let remove = [];
  var indices = Object.keys(aliases);
  for(var i = 0; i < indices.length; i++) {
    var index = indices[i];
    var alias = aliases[index];
    if(alias.aliases[aliasName]) {
      console.log(index, 'points to', aliasName.cyan, ', to be removed');
      remove.push({ index, alias: aliasName });
    }
  }

  console.log(index.cyan, 'to be added as an alias for', aliasName.cyan);
  add.push({ index, alias: aliasName});

  console.log();
  console.log('Updating alias'.bold, aliasName.cyan, '=>'.bold, indexName.cyan);
  grayput(yield api.updateAliases(add, remove));
  console.log('✔️ done'.green);
}

var options = require('yargs')
  .usage('Usage: $0 <command> [options]')
  .command('schema', 'Migrate index mapping to new version', y => {
    return y
      .usage('Usage: $0 schema [options]')
      .option('add-alias', { description: 'Add alias after reindexing' })
      .option('alias', { description: 'Alias to use, defaults to auto generated name.' });
  })
  .command('alias', 'Point index alias to a index version.', y => {
    return y
      .usage('Usage: $0 alias --index <indexName> --version <indexVersion> --alias <aliasName> [options]')
      .option('alias', {
        description: 'Alias name',
      })
      .demand(['prefix', 'index', 'version']);
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
            grayput(yield api.reindexFrom(fromIndex, indexName));
            console.log('✔️ done'.green);
          }

          if(options['add-alias']) {
            let aliasName = indexAliasName;
            
            if(options.alias) {
              aliasName = options.alias;
            }

            yield handleAliasUpdate(indexName, aliasName);
          }
          break;

        case 'alias':
          let aliasName = indexAliasName;
          if(options.alias) {
            aliasName = options.alias;
          }
          yield handleAliasUpdate(indexName, aliasName);
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

