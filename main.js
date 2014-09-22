var google = require('googleapis'),
    config = require('./lib/config'),
    grive = require('./lib/grive');

var OAuth2 = google.auth.OAuth2;
var authClient = new OAuth2(config.clientId, config.clientSecret, config.redirectURL);

// To gain access to the drive we need to provide credentials
authClient.setCredentials(config.credentials);

var drive = google.drive({
  auth: authClient,
  version: 'v2'
});

var griveInstance = new grive(drive, config.grive);

// Rest assured, Grive will do the processing
griveInstance.init();
