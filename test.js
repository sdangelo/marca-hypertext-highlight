#!/usr/bin/env node

var fs = require("fs");

var Marca = require("marca");
require("marca-hypertext")(Marca);

var root = Marca.parse(fs.readFileSync(process.argv[2], "utf8"));
var dom = Object.create(Marca.DOMElementHypertextRoot);
dom.init(root, Marca.HypertextElementProtos);

dom = require("./marca-hypertext-highlight.js")(Marca, dom);

require("marca-hypertext-tohtml")(Marca);

console.log(dom.toHTML(0));
