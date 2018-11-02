# es-schema-migration

Utility for managing versioned ES mapping migrations.


## Usage

```
$ node es-schema-migration.js --help       
Usage: es-schema-migration.js <command> [options]

Commands:
  schema  Migrate index mapping to new version

Options:
  --prefix           Prefix to be used in index names.                [required]
  --index            Name of the index.                               [required]
  --version          Version to migrate to.                           [required]
  --host             Elasticsearch URL        [default: "http://localhost:9200"]
  --delete-existing  Delete existing versioned index, if exists.       [boolean]
  --from             Reindex data from specified index
  --from-previous    Reindex data from previous version
  --help             Show help                                         [boolean]

```

```
$ node es-schema-migration.js schema --help
es-schema-migration.js schema

Options:
  --prefix           Prefix to be used in index names.                [required]
  --index            Name of the index.                               [required]
  --version          Version to migrate to.                           [required]
  --host             Elasticsearch URL        [default: "http://localhost:9200"]
  --delete-existing  Delete existing versioned index, if exists.       [boolean]
  --from             Reindex data from specified index
  --from-previous    Reindex data from previous version
  --help             Show help                                         [boolean]
  --add-alias        Add alias after reindexing                        [boolean]
  --alias            Alias to use, defaults to auto generated name.

```

Create index `foo-bar_v1` with new mapping from `./mappings/foo-bar_v1.json` and add alias to `foo-bar`.

```
node es-schema-migration.js schema --prefix foo --index bar --version 1 --add-alias
```

Create or recreate index `foo-bar_v2` with versioned mapping, reindex data from previous version (`foo-bar_v1`) and update alias `foo-bar`.

```
node es-schema-migration.js schema --prefix foo --index bar --version 2 --add-alias --delete-existing --from-previous
```


### Nice, but I need to run migrations on AWS ElasticSearch Service

Sure, no problem. Check out [aws-es-proxy](https://github.com/joona/aws-es-proxy), spin it up locally, and point `es-schema-migration` to the proxy.
