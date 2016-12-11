'use strict';

function ParseError(line, column, message) {
    this.line = line;
    this.column = column;
    this.message = message;
    this.stack = (new Error()).stack;
}
ParseError.prototype = Object.create(Error.prototype);
ParseError.prototype.constructor = ParseError;
ParseError.name = 'ParseError';


function defineClass(clazz) {
    return function() {
        var name, methods = clazz.apply(this, arguments);
        for (name in methods) {
            if (!methods.hasOwnProperty(name)) continue;
            this[name] = methods[name];
        }
    };
}

exports.defineClass = defineClass;
exports.ParseError = ParseError;
