"use strict";

var chokidar = require('chokidar')
  , promise = require('bluebird')
  , mimeTypes = require('./mimeTypes')
  , lang = require('./lang.js')
  , path = require('path')
  , fs = require('fs');

function Grive(drive, options) {
  this.directory = options.directory;
  this.remoteDrive = null;
  this.fileWatcher = null;

  // Construct promised APIs from Drive
  this.files = promise.promisifyAll(drive.files);
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
          // This will not create any directories unless it's required
          var promise = self.createRemoteDirectoryPath(path.dirname(file));

          promise.then(function(parent) {
            console.log(lang.create, self.relativePath(file), parent.title);

            // The file does not exist on the drive
            return self.createRemoteFile(file, parent);
          });
        }

        // In case the user added a file, when a directory with the exact same
        // path exists on the drive, skip all actions and ignore the file.
        if(result.mimeType === mimeTypes.folder) {
          console.log(lang.skipping, self.relativePath(file));
          return;
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
   * @return {Promise} Data progress
   * @api private
   */
  _getRemoteFolderContents: function(folder) {
    var self = this;

    // Create the files property if it does not exist
    folder.files = folder.files || {};

    // Retrieve all direct children to the folder (except for trashed files)
    return self.files.listAsync({
      q: "trashed = false and '" + folder.id + "' in parents"
    }).then(function(response) {
      var requests = [];

      response[0].items.forEach(function(file) {
        folder.files[file.id] = file;

        if(file.mimeType === mimeTypes.folder) {
          // If the file is a folder, recursively retrieve the content
          requests.push(self._getRemoteFolderContents(folder.files[file.id]));
        }
      });

      return promise.all(requests);
    });
  },
  /**
   * Watches the local file system for changes
   *
   * @param {String} Directory to observe
   * @return {FSWatcher} Filesystem watcher
   * @api private
   */
  _watchLocalContent: function() {
    var self = this;
    var watchOptions = {
      ignoreInitial: false,
      persistent: true
    };

    return chokidar.watch(self.directory, watchOptions)
      .on('all', function(event, absolutePath) {
        self._onContentChange(event, absolutePath);
      });
  },
  /**
   * Converts a local absolute path to a Google Document relative path
   *
   * @param {String} Absolute file path
   * @return {String} Relative file path (Google Drive)
   */
  relativePath: function(localPath) {
    return path.relative(this.directory, localPath);
  },
  /**
   * Retrieves the Google Drive object of a local file
   *
   * @param {String} Absolute file path
   * @param {Object} File parent information (closest)
   * @return {Object} Drive object (or false if not found)
   * @api public
   */
  mapLocalToRemote: function(localPath, parent) {
    // We want the relative path when comparing with Google Drive
    var relativePath = this.relativePath(localPath);
    var paths = relativePath.split(path.sep);
    var maxDepth = 0;

    if(parent) {
      parent.file = this.remoteDrive;
      parent.depth = 0;
      parent.path = '';
    }

    if(relativePath.length === 0) {
      return this.remoteDrive;
    }

    // We define an inner function to utilize recursive behavior
    return (function implMapLocalToRemote(folder, parentPath, depth) {
      if(depth > paths.length) {
        return false;
      }

      for(var key in folder.files) {
        if(!folder.files.hasOwnProperty(key)) {
          continue;
        }

        var file = folder.files[key];
        var currentPath = (parentPath ? (parentPath + '/') : '') + file.title;

        if(relativePath === currentPath) {
          return file;
        }

        if(file.mimeType !== mimeTypes.folder) {
          continue;
        }

        // Ensure that the file path is in the directory
        if(paths[depth] === currentPath.split(path.sep)[depth]) {
          var localResult = implMapLocalToRemote(file, currentPath, ++depth);

          // We update the *outer* result of the closest parent
          if(depth > maxDepth) {
            // file is now the closest parent to the path
            maxDepth = depth;

            if(parent) {
              parent.path = currentPath;
              parent.depth = depth;
              parent.file = file;
            }
          }

          if(localResult) {
            return localResult;
          }
        }
      }

      return false;
    })(this.remoteDrive, '', 0);
  },
  /**
   * Creates/uploads a file to Google Drive
   *
   * @param {String} Absolute file path
   * @param {Object} Google Drive folder
   * @return {Promise} File created
   * @api public
   */
  createRemoteFile: function(localPath, parent) {
    // Default to root if no parent is set
    parent = parent || this.remoteDrive;

    var extension = path.extname(localPath);
    var fileType = (extension in mimeTypes) ?
      mimeTypes[extension] : mimeTypes.default;

    return this.files.insertAsync({
      resource: {
        title: path.basename(localPath),
        parents: [{ id: parent.id }],
        mimeType: fileType
      },
      media: {
        body: fs.createReadStream(localPath),
        mimeType: fileType
      }
    }).then(function(response) {
      var file = response[0];
      return (parent.files[file.id] = file);
    });
  },
  /**
   * Creates a directory on Google Drive
   *
   * @param {String} Directory name
   * @param {Object} Google Drive folder
   * @return {Promise} Directory created
   * @api public
   */
  createRemoteDirectory: function(name, parent) {
    // Default to root if no parent is set
    parent = parent || this.remoteDrive;

    return this.files.insertAsync({
      resource: {
        parents: [{ id: parent.id }],
        mimeType: mimeTypes.folder,
        title: name
      }
    }).then(function(response) {
      var file = response[0];
      file.files = {};
      return (parent.files[file.id] = file);
    });
  },
  /**
   * Creates a directory path on Google Drive
   *
   * @param {String} Absolute file path
   * @return {Promise} Directories created
   * @api public
   */
  createRemoteDirectoryPath: function(localPath) {
    var self = this;
    var parent = {};

    // Get the remote file and closest parent (from the path)
    var remoteFile = self.mapLocalToRemote(localPath, parent);

    if(remoteFile) {
      return promise.resolve(remoteFile);
    }

    // Retrieve a relative path to the closest parent folder
    var paths = path.relative(
      parent.path, self.relativePath(localPath)).split(path.sep);

    return (function implCreateRemoteDirectoryPath(parent, depth) {
      // We require the name of the current folder (path index)
      var name = paths[depth++];

      return self.createRemoteDirectory(name, parent).then(function(newParent) {
        if(depth < paths.length) {
          return implCreateRemoteDirectoryPath(newParent, depth);
        } else {
          return newParent;
        }
      });
    })(parent.file, 0);
  },
  /**
   * Initializes the GriveJS instance
   *
   * @api public
   */
  init: function() {
    var self = this;

    self.files.getAsync({ fileId: 'root'}).then(function(response) {
      self.remoteDrive = response[0];
      self._getRemoteFolderContents(self.remoteDrive).done(function() {
        self.fileWatcher = self._watchLocalContent();
        console.log(lang.retrieved);
      });
    });
  }
};

module.exports = Grive;
