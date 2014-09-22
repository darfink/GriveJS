var path = require('path')
  , fs = require('fs');

var env = process.env['NODE_ENV'] || 'development';
var jsonPath = path.join(__dirname, '../config', env + '.json');

var config = JSON.parse(fs.readFileSync(jsonPath));

config.env = env;

module.exports = config;
