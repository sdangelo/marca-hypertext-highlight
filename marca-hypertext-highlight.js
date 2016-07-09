/*
 * Copyright (C) 2016 Stefano D'Angelo <zanga.mail@gmail.com>
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

var hljs = require("highlight.js");
hljs.configure({classPrefix: "", languages: []});

function decodeHTML(string) {
	return string.replace(/&gt;/g, ">")
		     .replace(/&lt;/g, "<")
		     .replace(/&quot;/g, '"')
		     .replace(/&#(\d+);/g, "'",
			function (match, dec) {
				return String.fromCharCode(dec);
			})
		     .replace(/&amp;/g, "&");
	// TODO?: full list of HTML entities...
}

function parseHTML(html, dom, classPrefix) {
	while (html) {
		var i = html.indexOf("<");
		if (i < 0) {
			dom.push(decodeHTML(html));
			return;
		}
		else if (i > 0) {
			dom.push(decodeHTML(html.substring(0, i)));
			html = html.substring(i);
			if (html.charAt(1) == "/")
				return html.substring(7);
		}

		var spanRe = /<span class="([^"]+)">/;
		var span = spanRe.exec(html);
		var classAttr = (classPrefix ? classPrefix + "-" : "")
				+ span[1];
		html = html.substring(span[0].length);
		var elem = { classAttr: classAttr, children: [] };
		dom.push(elem);
		html = parseHTML(html, elem.children);
	}
}

function getText(Marca, element) {
	var text = "";
	for (var i = 0; i < element.children.length; i++) {
		var child = element.children[i];
		if (Marca.DOMElementText.isPrototypeOf(child))
			text += child.text;
		else
			text += getText(Marca, child);
	}
	return text;
}

function analyseElem(Marca, elem, offset) {
	if (Marca.DOMElementText.isPrototypeOf(elem))
		return { offset: offset, length: elem.text.length,
			 highlight: true, highlightAll: true, element: elem};

	var length = 0;
	var children = [];
	var highlightAll = true;
	for (var i = 0; i < elem.children.length; i++) {
		var child = elem.children[i];
		var data = analyseElem(Marca, child, offset + length);
		length += data.length;

		if (child.meta && child.meta.highlight) {
			data.highlight = false;
			data.highlightAll = false;
			highlightAll = false;
		} else
			data.highlight = true;

		children.push(data);
	}

	return { children: children, offset: offset, length: length,
		 highlight: true, highlightAll: highlightAll, element: elem };
}

function analyseSpan(span, offset) {
	var length = 0;
	var children = [];
	for (var i = 0; i < span.children.length; i++) {
		var child = span.children[i];

		if (typeof child == "string") {
			length += child.length;
			continue;
		}

		var data = analyseSpan(child, offset + length);
		data.classAttr = child.classAttr;
		length += data.length;
		children.push(data);
	}

	return { children: children, offset: offset, length: length };
}

function splitElem(Marca, elemAnalysis, at) {
	if (!elemAnalysis.children) {
		var text = elemAnalysis.element.text;
		var e1 = Object.create(elemAnalysis.element);
		var e2 = Object.create(elemAnalysis.element);
		e1.text = text.substring(0, at - elemAnalysis.offset);
		e2.text = text.substring(at - elemAnalysis.offset);
		return [ analyseElem(Marca, e1, elemAnalysis.offset),
			 analyseElem(Marca, e2, at) ];
	}

	var children = elemAnalysis.children;
	var c1 = [];
	var c2 = [];
	var i = 0;
	for (; children[i].offset + children[i].length <= at; i++)
		c1.push(children[i]);
	if (children[i].offset < at) {
		var res = splitElem(Marca, children[i], at);
		c1.push(res[0]);
		c2.push(res[1]);
		i++;
	}
	for (; i < children.length; i++)
		c2.push(children[i]);

	var e1 = Object.create(elemAnalysis.element);
	var e2 = Object.create(elemAnalysis.element);
	e1.children = [];
	e2.children = [];
	for (var i = 0; i < c1.length; i++)
		e1.children[i] = c1[i].element;
	for (var i = 0; i < c2.length; i++)
		e2.children[i] = c2[i].element;

	return [ analyseElem(Marca, e1, elemAnalysis.offset),
		 analyseElem(Marca, e2, at) ];
}
		
function splitSpan(span, begin, end) {
	var spanEnd = span.offset + span.length;
	
	if ((span.offset < begin && spanEnd <= begin) || span.offset >= end)
		return span;
			
	if (span.offset >= begin && spanEnd <= end)
		return null;
			
	for (var i = 0; i < span.children.length; i++) {
		var res = splitSpan(span.children[i], begin, end);
		if (!res) {
			span.children.splice(i, 1);
			i--;
		} else if (Array.isArray(res)) {
			span.children.splice(i, 1, res[0], res[1]);
			i++;
		} else
			span.children[i] = res;
	}
				
	if (span.offset < begin && spanEnd > end) {
		var res = [ { children: [], offset: span.offset,
			      length: begin - span.offset,
			      classAttr: span.classAttr },
			    { children: [], offset: end,
			      length: spanEnd - end,
			      classAttr: span.classAttr } ];

		if (span.children.length) {
			var i = 0;
			for (; span.children[i].offset < begin; i++)
				res[0].children.push(span.children[i]);
			for (; i < span.children.length; i++)
				res[1].children.push(span.children[i]);
		}

		return res;
	} else {
		if (span.offset < begin)
			span.length = begin - span.offset;
		else {
			span.length = spanEnd - end;
			span.offset = end;
		}
		return span;
	}
}

function splitSpanNormalized(span, begin, end) {
	var ret = splitSpan(span, begin, end);
	if (Array.isArray(ret))
		ret = { children: ret, offset: ret[0].offset,
			length: ret[1].offset - ret[0].offset
				+ ret[1].length };
	else if (!ret)
		ret = { children: [], offset: span.offset,
			length: span.length };
	return ret;
}

function splitSpanNoHighlight(elemAnalysis, spanAnalysis) {
	if (elemAnalysis.highlightAll)
		return spanAnalysis;

	if (!elemAnalysis.highlight)
		return splitSpanNormalized(spanAnalysis, elemAnalysis.offset,
					   elemAnalysis.offset
					   + elemAnalysis.length);

	if (elemAnalysis.children)
		for (var i = 0; i < elemAnalysis.children.length; i++)
			spanAnalysis =
				splitSpanNoHighlight(elemAnalysis.children[i],
						     spanAnalysis);

	return spanAnalysis;
}


module.exports = function (Marca, element, classPrefix) {
	function mapElems(array) {
		return array.map(function (obj) { return obj.element });
	}

	function doHighlightElem(elemAnalysis, spanAnalysis) {
		var spanEnd = spanAnalysis.offset + spanAnalysis.length;

		var j = 0;
		while (elemAnalysis.children[j].offset
		       + elemAnalysis.children[j].length <= spanAnalysis.offset)
			j++;
		var eChild = elemAnalysis.children[j];
		var eChildren = [];
		for (var k = j;
		     elemAnalysis.children[k]
		     && elemAnalysis.children[k].offset < spanEnd; k++)
			eChildren.push(elemAnalysis.children[k]);
		k--;
		var eChild2 = elemAnalysis.children[k];

		if (j == k) {
			var res = doHighlight(eChild, spanAnalysis);
			if (!Array.isArray(res))
				elemAnalysis.element.children
					    .splice(j, 1, res.element);
			else {
				var elems = mapElems(res);
				elemAnalysis.element.children =
					elemAnalysis.element.children
						    .slice(0, j)
						    .concat(elems)
						    .concat(
							elemAnalysis.element
								.children
								.slice(j + 1));
			}
			elemAnalysis = analyseElem(Marca, elemAnalysis.element,
						   elemAnalysis.offset);
		} else if (k == j + 1 && spanAnalysis.offset != eChild.offset
			   && spanEnd != eChild2.offset + eChild2.length) {
			var be = eChild.offset + eChild.length;
			var s = splitSpan(spanAnalysis, be, be);
			var res1 = doHighlight(elemAnalysis, s[0]).children
								  .slice(0, k);
			var res2 = doHighlight(elemAnalysis, s[1]).children
								  .slice(k);
			var elems1 = mapElems(res1);
			var elems2 = mapElems(res2);
			elemAnalysis.element.children = elems1.concat(elems2);
			elemAnalysis = analyseElem(Marca, elemAnalysis.element,
						   elemAnalysis.offset);
		} else {
			if (spanAnalysis.classAttr) {
				var span = Object.create(
						Marca.DOMElementHypertextSpan);
				span.meta = {};
				span.id = undefined;
				span.class = spanAnalysis.classAttr;

				var pre;
				var post;
				if (spanAnalysis.offset != eChild.offset) {
					pre = splitElem(Marca, eChild,
							spanAnalysis.offset);
					eChildren[0] = pre[1];
				}
				if (spanEnd != eChild2.offset + eChild2.length)
				{
					post = splitElem(Marca, eChild2,
							 spanEnd);
					eChildren[eChildren.length - 1] =
						post[0];
				}

				span.children = [];
				for (var i = 0; i < eChildren.length; i++)
					span.children[i] = eChildren[i].element;

				if (pre) {
					elemAnalysis.element.children
						    .splice(j, 0,
							    pre[0].element);
					j++;
				}
				elemAnalysis.element.children
					    .splice(j, eChildren.length, span);
				if (post)
					elemAnalysis.element.children
						    .splice(j + 1, 0,
							    post[1].element);

				elemAnalysis = analyseElem(Marca,
							   elemAnalysis.element,
							   elemAnalysis.offset);
			}

			for (var i = 0; i < spanAnalysis.children.length; i++) {
				var sChild = spanAnalysis.children[i];
				var res = doHighlight(elemAnalysis, sChild);
				if (!Array.isArray(res))
					elemAnalysis = res;
				else {
					elemAnalysis.element.children = [];
					for (var j = 0; j < res.length; j++)
						elemAnalysis.element.children[j]
							= res[j].element;
					elemAnalysis =
						analyseElem(Marca,
							elemAnalysis.element,
							elemAnalysis.offset);
				}
			}
		}

		return elemAnalysis;
	}

	function doHighlightText(elemAnalysis, spanAnalysis) {
		var text = elemAnalysis.element.text;

		var elemEnd = elemAnalysis.offset + elemAnalysis.length;
		var spanEnd = spanAnalysis.offset + spanAnalysis.length;

		var pre = null;
		var preAnalysis = null;
		var post = null;
		var postAnalysis = null;

		if (elemAnalysis.offset != spanAnalysis.offset) {
			pre = Object.create(Marca.DOMElementText);
			pre.init(text.substring(0, spanAnalysis.offset
						   - elemAnalysis.offset));
			preAnalysis = analyseElem(Marca, pre,
						  elemAnalysis.offset);
		}

		if (elemEnd != spanEnd) {
			post = Object.create(Marca.DOMElementText);
			post.init(text.substring(
				spanAnalysis.offset - elemAnalysis.offset
				+ spanAnalysis.length));
			postAnalysis = analyseElem(Marca, post,
				spanAnalysis.offset + spanAnalysis.length);
		}

		if (pre || post) {
			var elem = Object.create(Marca.DOMElementText);
			elem.init(text.substring(
				spanAnalysis.offset - elemAnalysis.offset,
				spanAnalysis.offset - elemAnalysis.offset
				+ spanAnalysis.length));
			var x = analyseElem(Marca, elem, spanAnalysis.offset);
			var internal = doHighlightText(x, spanAnalysis);
			var ret = pre ? [preAnalysis, internal] : [internal];
			return post ? ret.concat(postAnalysis) : ret;
		}

		var children = [];
		if (spanAnalysis.children.length) {
			var offset = spanAnalysis.offset;
			for (var i = 0; i < spanAnalysis.children.length; i++) {
				var child = spanAnalysis.children[i];

				if (offset != child.offset) {
					var elem = Object.create(
							Marca.DOMElementText);
					elem.init(text.substring(
						offset - elemAnalysis.offset,
						child.offset
						- elemAnalysis.offset));
					children.push(elem);
					offset += child.offset - offset;
				}

				var elem = Object.create(Marca.DOMElementText);
				elem.init(text.substring(
					child.offset - elemAnalysis.offset,
					child.offset - elemAnalysis.offset
					+ child.length));
				offset += child.length;

				var x = analyseElem(Marca, elem, child.offset);
				var res = doHighlight(x, child);
				elem = res.element;
				children.push(elem);
			}
		 	if (offset != elemAnalysis.offset + elemAnalysis.length)
			{
				var elem = Object.create(Marca.DOMElementText);
				offset -= elemAnalysis.offset;
				elem.init(text.substring(offset));
				children.push(elem);
			}
		} else
			children.push(elemAnalysis.element);

		var span = Object.create(Marca.DOMElementHypertextSpan);
		span.children = children;
		span.meta = {};
		span.id = undefined;
		span.class = spanAnalysis.classAttr;

		elemAnalysis = analyseElem(Marca, span, elemAnalysis.offset);

		return spanAnalysis.classAttr ? elemAnalysis
					      : elemAnalysis.children;
	}

	function doHighlight(elemAnalysis, spanAnalysis) {
		// spanAnalysis always contained in elemAnalysis

		// TBD?: element.class should be array
		if (!spanAnalysis.classAttr && !spanAnalysis.children.length)
			return elemAnalysis;

		return elemAnalysis.children
			? doHighlightElem(elemAnalysis, spanAnalysis)
			: doHighlightText(elemAnalysis, spanAnalysis);
	}

	function highlight(element, language) {
		var text = getText(Marca, element);
		var html = hljs.highlight(language, text, false).value;
		
		var htmlDom = [];
		parseHTML(html, htmlDom, classPrefix);
		htmlDom = { children: htmlDom };

		var elemAnalysis = analyseElem(Marca, element, 0);
		var spanAnalysis = analyseSpan(htmlDom, 0);
		spanAnalysis = splitSpanNoHighlight(elemAnalysis, spanAnalysis);

		return doHighlight(elemAnalysis, spanAnalysis).element;
	}

	function findToHighlight(element, inner) {
		var language = element.meta.highlight
			       ? hljs.getLanguage(element.meta.highlight)
			       : null;

		for (var i = 0; i < element.children.length; i++)
			element.children[i] =
				findToHighlight(element.children[i],
						language || inner);

		if (!language)
			return element;

		element = highlight(element, element.meta.highlight);

		if (inner)
			return element;

		var text = getText(Marca, element);

		var i = text.indexOf("\n");
		if (i == -1)
			return element;

		var span = Object.create(Marca.DOMElementHypertextSpan);
		span.meta = {};
		span.class = (classPrefix ? classPrefix + "-" : "") + "line";
		span.id = undefined;
		span.children = element.children;

		elemAnalysis = analyseElem(Marca, span, 0);
		element.children = [];
		var res;
		i--;
		var j = 0;
		do {
			i += j + 1;
			res = splitElem(Marca, elemAnalysis, i);
			element.children.push(res[0].element);
			var s = Object.create(Marca.DOMElementText);
			s.init("\n");
			element.children.push(s);
			elemAnalysis = res[1];
			res = splitElem(Marca, elemAnalysis, i + 1);
			elemAnalysis = res[1];
			j = text.substring(i + 1).indexOf("\n");
		} while (j != -1);
		element.children.push(res[1].element);

		element.class = (element.class ? element.class + " " : "")
				+ (classPrefix ? classPrefix + "-" : "")
				+ "multiline";

		return element;
	}

	return findToHighlight(element, false);
};
