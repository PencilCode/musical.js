module.exports = function(grunt) {
  "use strict";

  grunt.initConfig({
    pkg: grunt.file.readJSON("package.json"),
    bowercopy: {
      options: {
        clean: true
      },
      test: {
        options: {
          destPrefix: "test/lib"
        },
        files: {
          "qunit.js" : "qunit/qunit/qunit.js",
          "qunit.css" : "qunit/qunit/qunit.css",
          "require.js" : "requirejs/require.js"
        }
      }
    },
    uglify: {
      all: {
        files: {
          "musical.min.js": [ "musical.js" ]
        },
        options: {
          preserveComments: false,
          report: "min",
          beautify: {
            ascii_only: true
          }
        }
      }
    },
    connect: {
      testserver: {
        options: {
          hostname: '0.0.0.0'
        }
      }
    },
    qunit: {
      all: ["test/*.html"]
    },
    watch: {
      testserver: {
        files: [],
        tasks: ['connect:testserver'],
        options: { atBegin: true, spawn: false }
      },
    },
    release: {
      options: {
        bump: false
      }
    }
  });

  grunt.loadNpmTasks('grunt-bowercopy');
  grunt.loadNpmTasks('grunt-contrib-connect');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-qunit');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-release');

  grunt.task.registerTask('test', 'Run unit tests, or just one test.',
  function(testname) {
    if (!!testname) {
      grunt.config('qunit.all', ['test/' + testname + '.html']);
    }
    grunt.task.run('qunit:all');
  });

  grunt.registerTask("testserver", ["watch:testserver"]);
  grunt.registerTask("default", ["uglify", "qunit"]);
};

