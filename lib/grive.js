var chokidar = require('chokidar')
  , deferred = require('deferred')
  , mimeTypes = require('./mimeTypes')
  , path = require('path')
  , fs = require('fs');

function Grive(drive, options) {
  this.directory = options.directory;
  this.remoteDrive = null;
  this.fileWatcher = null;
  this.drive = drive;
}

Grive.prototype = {
  /**
   * Triggered when a local file event occurs
   *
   * @param {String} Describes the event
   * @param {String} Absolute file path
   * @api private
   */
  _onContentChange: function(event, file) {
    var self = this;

    var eventHandler = {
      add: function() {
        // Retrieve the Google Drive object of the file
        var result = self.mapLocalToRemote(file);

        if(!result) {
          console.log(file);
          self.uploadLocalFile(file);
        }
      },
      addDir: function() {
      },
      change: function() {
      },
      unlink: function() {
      },
      unlinkDir: function() {
      },
      error: function() {
      }
    };

    eventHandler[event]();
  },
  /**
   * Retrieves a folders content on Google Drive
   *
   * @param {Object} Google Drive folder
   * @param {Deferred} Deferred progress
   * @return {Promise} Data progress
   * @api private
   */
  _getRemoteFolderContents: function(folder, argDeferred) {
    var localDeferred = argDeferred || deferred();
    var self = this;

    if(!localDeferred.count) {
      localDeferred.count = 1;
    } else {
      localDeferred.count++;
    }

    // Create the files property if it does not exist
    folder.files = folder.files || {};

    // Retrieve all direct children to the folder unless the items are marked as trash
    self.drive.files.list({ q: "trashed = false and '" + folder.id + "' in parents" }, function(error, response) {
      if(error) {
        console.log(error);
        return;
      }

      response.items.forEach(function(file, index) {
        folder.files[file.id] = file;

        if(file.mimeType == mimeTypes.folder) {
          // If the file is a folder, recursively retrieve the content
          self._getRemoteFolderContents(folder.files[file.id], localDeferred);
        }
      });

      if(--localDeferred.count == 0) {
        localDeferred.resolve();
      }
    });

    return localDeferred.promise;
  },
  /**
   * Watches the local file system for changes
   *
   * @param {String} Directory to observe
   * @return {FSWatcher} Filesystem watcher
   * @api private
   */
  _watchLocalContent: function(directory) {
    var self = this;
    var watchOptions = {
      ignoreInitial: false,
      persistent: true
    };

    return chokidar.watch(directory, watchOptions).on('all', function(event, absolutePath, stat) {
      self._onContentChange(event, absolutePath);
    });
  },
  /**
   * Retrieves the Google Drive object of a local file
   *
   * @param {String} Absolute file path
   * @return {Object} Drive object (or false if not found)
   * @api public
   */
  mapLocalToRemote: function(localPath) {
    // We want the relative path when comparing with Google Drive
    var relativePath = path.relative(this.directory, localPath);

    // We define an inner function to utilize recursive behavior
    return (function ImplMapLocalToRemote(folder, parentPath) {
      for(var key in folder.files) {
        var file = folder.files[key];
        var currentPath = (parentPath ? (parentPath + '/') : '') + file.title;

        if(relativePath == currentPath) {
          return file;
        }

        if(file.mimeType == mimeTypes.folder) {
          var result = ImplMapLocalToRemote(file, currentPath);

          if(result) {
            return result;
          }
        }
      }

      return false;
    })(this.remoteDrive, '');
  },
  /**
   * Uploads a local file to Google Drive
   *
   * @api public
   */
  uploadLocalFile: function(localPath, parent) {
    // Default to root if no parent is set
    parent = parent || this.remoteDrive;

    var extension = path.extname(localPath);
    var fileType = (extension in mimeTypes) ?
      mimeTypes[extension] : mimeTypes.default;

    this.drive.files.insert({
      resource: {
        title: path.basename(localPath),
        parents: [{ id: parent.id }],
        mimeType: fileType
      },
      media: {
        body: fs.createReadStream(localPath),
        mimeType: fileType
      }
    }, function(error, response) {
      if(error) {
        console.log(error);
        return;
      }

      console.log(response);
    });
  },
  /**
   * Initializes the GriveJS instance
   *
   * @api public
   */
  init: function() {
    var self = this;

    // Retrieve the ID of the 'My Drive' folder (a.k.a root)
    self.drive.files.get({ fileId: 'root' }, function(error, response) {
      if(error) {
        console.log(error);
        return;
      }

      self.remoteDrive = response;
      self.remoteDrive.path = '';

      self._getRemoteFolderContents(self.remoteDrive).done(function() {
        self.fileWatcher = self._watchLocalContent(self.directory);
      });
    });
  }
};

module.exports = Grive;
