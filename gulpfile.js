var async = require("async");
var browserify = require("browserify");
var chalk = require("chalk");
var chmod = require("gulp-chmod");
var dateformat = require("dateformat");
var ejs = require("gulp-ejs");
var fs = require("fs");
var gulp = require("gulp");
var gulpif = require('gulp-if');
var httpServer = require("http-server");
var rename = require("gulp-rename");
var slimerPath = require("slimerjs").path;
var source = require("vinyl-source-stream");
var buffer = require('vinyl-buffer');
var spawn = require("child_process").spawn;
var path = require('path');
var uglify = require('gulp-uglify');
var portfinder = require('portfinder');
var argv = require('yargs').argv;

var log = function() {
	var time = "[" + chalk.blue(dateformat(new Date(), "HH:MM:ss")) + "]";
	var args = Array.prototype.slice.call(arguments);
	args.unshift(time);
	console.log.apply(console, args);
};

var listSubDirs = function(parentDir) {
	var dirs = fs.readdirSync(parentDir);
	dirs = dirs.filter(function(dir) {
		var stat = fs.statSync(path.join(parentDir, dir));
		if (!stat) return false;
		if (!stat.isDirectory) return false;
		return true;
	});
	return dirs;
}

var runBrowserify = function(dir, callback) {
	var src = "./src/" + dir;
	var file = src + "/main.js";
	var dest = "./dist/examples/" + dir;

	var bundler = browserify(file);

	log("browserify " + chalk.cyan(dir) + " started");

	bundler.transform({ global: true }, "brfs");
	bundler.ignore("plask");

	bundler.on("log", function(data) {
		var logString = data.split(" ").map(function(word) {
			word = word.replace(/\(|\)/g, "");
			return !isNaN(word) ? chalk.magenta(word) : word;
		}).join(" ");

		log("browserify " + chalk.cyan(dir) + " " + logString);
	});

	bundler.on("error", function(error) {
		log(chalk.red(error.message));
	});

	bundler
		.bundle()
		.pipe(source("main.min.js"))
		.pipe(chmod(644))
		.pipe(gulpif(argv.uglify, buffer()))
		.pipe(gulpif(argv.uglify, uglify()))
		.pipe(gulp.dest(dest))
		.on("finish", function() {
			log("browserify " + chalk.cyan(dir) + " finished!");
			callback();
		});
};

var exampleHtml = function(dir, callback) {
	var src = "./templates/example.ejs";
	var dest = "./dist/examples/" + dir;

	gulp.src(src)
		.pipe(ejs({ title: dir }))
		.pipe(rename("index.html"))
		.pipe(gulp.dest(dest))
		.on("finish", callback);
};

var mkdir = function(dir, callback) {
	spawn("mkdir", [ "-p", dir ]).on("exit", callback);
};

gulp.task("browserify", [ "file-structure" ], function(callback) {
	var limit = 4;

	var srcPath = "./src/";

	var dirs = listSubDirs(srcPath);

	if (argv.dir) {
		dirs = [ argv.dir ];
	}

	async.eachLimit(
		dirs,
		limit,
		function(dir, callback) {
			fs.stat("./src/" + dir, function(error, stat) {
				if (error) { return callback(error); }
				if (!stat.isDirectory()) { return callback(); }

				async.series(
					[
						mkdir.bind(this, "./dist/examples/" + dir),
						exampleHtml.bind(this, dir),
						runBrowserify.bind(this, dir)
					],
					callback
				);
			});
		},
		callback
	);
});

gulp.task("file-structure", function(callback) {
	log(chalk.cyan("file structure") + " building");

	async.each(
		[ "./dist/examples", "./dist/assets", "./dist/fonts" ],
		mkdir,
		function() {
			gulp
				.src("./assets/**")
				.pipe(gulp.dest("./dist/assets/"))
				.on("finish", function() {
					log(chalk.cyan("file structure") + " done");
					callback();
				});
		}
	);
});

var slimerScreenshot = function(url, thumbPath, callback) {
	var spawned = spawn(slimerPath, [ "./utils/slimer-script.js", url, thumbPath ]);

	spawned.stdout.on("data", function(data) {
		log("slimer " + chalk.cyan(url) + "\n" + data.toString());
  });

  spawned.on("exit", callback);
};

gulp.task("make-screenshots", function(callback) {
	var examplesPath = "./dist/examples";

	var dirs = listSubDirs(examplesPath);

	if (argv.dir) {
		dirs = [ argv.dir ];
	}

	portfinder.getPort(function (err, port) {
    var server = httpServer.createServer({ root: "./dist/" });
		server.listen(port, function(err) {
			makeScreenshots(server);
		});
  });

	function makeScreenshots(serverInstance) {
		var host = "http://localhost:" + serverInstance.server.address().port;
		async.eachSeries(
			dirs,
			function(dir, callback) {
				var url = host + "/examples/" + dir + "/";
				var thumbPath = path.join(examplesPath, dir, "thumb.jpg");
				slimerScreenshot(url, thumbPath, callback)
			},
			function() {
				serverInstance.close();
				callback();
			}
		);
	}
});

gulp.task("copy-fonts", function(callback) {
	gulp
		.src("templates/fonts/*.{ttf,txt}")
		.pipe(gulp.dest("./dist/fonts/"))
		.on("finish", callback);
});

gulp.task("build-index", ["copy-fonts"], function(callback) {
	var src = "./templates/index.ejs";
	var dest = "./dist/";

	fs.readdir("./dist/examples/", function(error, directories) {
		if (error) { return console.error(error); }

		async.filter(
			directories,

			function(dir, callback) {
				fs.stat("./dist/examples/" + dir, function(error, stat) {
					if (error) { return callback(error); }
					callback(stat.isDirectory());
				});
			},

			function(examples) {
				gulp
					.src(src)
					.pipe(ejs({ examples: examples }))
					.pipe(gulp.dest(dest))
					.on("finish", callback);
			}
		);
	});
});

gulp.task("dist", function() {
	async.eachSeries(
		[
			"browserify",
			"make-screenshots",
			"build-index"
		],
		function(task, callback) {
			gulp.run(task, callback);
		}
	);
});
