'use strict';

var utils = require('./utils'),
    defineClass = utils.defineClass,
    ParseError = utils.ParseError;

function ScssToken() {}
ScssToken.prototype.isLiteral = false;
ScssToken.prototype.isOperator = false;
ScssToken.prototype.isSymbol = false;
ScssToken.prototype.isComment = false;
ScssToken.prototype.isWhitespace = false;

function defineToken(clazz, tokenType) {
    clazz.prototype = Object.create(ScssToken.prototype);
    clazz.prototype.constructor = ScssToken;
    clazz.prototype[tokenType] = true;
}

// ---------- literals ----------

var SCSS_LITERAL_NUMBER = 1,
    SCSS_LITERAL_IDENTIFIER = 2, // includes variable names
    SCSS_LITERAL_DIMENSION = 3,
    SCSS_LITERAL_COLOR = 4,
    SCSS_LITERAL_STRING = 5, // a primitive string, anything between two quotes
    SCSS_LITERAL_INTERPOLATED_STRING = 6, // a complex string, a sequence of primitive strings and expressions
    SCSS_LITERAL_ATRULE = 7;

function ScssNumber(n) {
    this.literalType = SCSS_LITERAL_NUMBER;
    this.value = n;
}
defineToken(ScssNumber, 'isLiteral');

function ScssIdentifier(ident) {
    this.literalType = SCSS_LITERAL_IDENTIFIER;
    this.value = ident;
}
defineToken(ScssIdentifier, 'isLiteral');

function ScssDimension(n, unit) {
    this.literalType = SCSS_LITERAL_DIMENSION;
    this.value = n;
    this.unit = unit;
}
defineToken(ScssDimension, 'isLiteral');

function ScssColor(color) {
    this.literalType = SCSS_LITERAL_COLOR;
    this.value = color;
}
defineToken(ScssColor, 'isLiteral');

function ScssPrimitiveString(s) {
    this.literalType = SCSS_LITERAL_STRING;
    this.value = s;
}
defineToken(ScssPrimitiveString, 'isLiteral');

function ScssInterpolatedString(list) {
    this.literalType = SCSS_LITERAL_INTERPOLATED_STRING;
    this.value = list;
}
defineToken(ScssInterpolatedString, 'isLiteral');

function ScssAtrule(name) {
    this.literalType = SCSS_LITERAL_ATRULE;
    this.value = name;
}
defineToken(ScssAtrule, 'isLiteral');

// ---------- comments ----------

var COMMENT_SINGLELINE = 1, COMMENT_MULTILINE = 2;

function ScssComment(comment, type) {
    this.value = comment;
    this.commentType = type;
}
defineToken(ScssComment, 'isComment');

// ---------- other tokens ----------

function ScssSymbol(sym) {
    this.value = sym;
}
defineToken(ScssSymbol, 'isSymbol');

function ScssOperator(operator) {
    this.value = operator;
}
defineToken(ScssOperator, 'isOperator');

function ScssWhitespace(space) {
    this.value = space;
}
defineToken(ScssWhitespace, 'isWhitespace');

// ---------- constants and utility functions ----------

var spaces = {
    ' ': true,
    '\n': true,
    '\r': true,
    '\t': true
};

var digits = {
    '0': true,
    '1': true,
    '2': true,
    '3': true,
    '4': true,
    '5': true,
    '6': true,
    '7': true,
    '8': true,
    '9': true
};

var alphas = {'_': true};
(function() {
    var i;
    for (i = 65; i < 91; i++) alphas[String.fromCharCode(i)] = true; // upper case
    for (i = 97; i < 123; i++) alphas[String.fromCharCode(i)] = true; // lower case
})();

var units = {
    'em': true,
    'ex': true,
    'ch': true,
    'rem': true,
    'vh': true,
    'vw': true,
    'vmin': true,
    'vmax': true,
    'px': true,
    'mm': true,
    'q': true,
    'cm': true,
    'in': true,
    'pt': true,
    'pc': true
};

function isSpace(c) {
    return c in spaces;
}

function isDigit(c) {
    return c in digits;
}

function isAlpha(c) {
    return c in alphas;
}

function isUnit(c) {
    return c in units;
}

var BOF = new ScssSymbol(''), // left sentinel when we start parsing
    // symbols
    LBRACE = new ScssSymbol('{'),
    RBRACE = new ScssSymbol('}'),
    COLON = new ScssSymbol(':'), // can be a delimiter, or in pseudo-class selectors
    SEMICOLON = new ScssSymbol(';'),
    COMMA = new ScssSymbol(','),
    LPAREN = new ScssSymbol('('),
    RPAREN = new ScssSymbol(')'),
    // numerical operators
    PlUS = new ScssOperator('+'), // also combinator in adjacent sibling selectors
    MINUS = new ScssOperator('-'),
    NEGATION = new ScssOperator('-'),
    ASTERISK = new ScssOperator('*'), // also universal selector
    SLASH = new ScssOperator('/'),
    PERCENT = new ScssOperator('%'),
    // relational operators
    EQUAL = new ScssOperator('=='),
    NOT_EQUAL = new ScssOperator('!='),
    LESS_THAN = new ScssOperator('<'),
    LESS_THAN_OR_EQUAL = new ScssOperator('<='),
    GREATER_THAN = new ScssOperator('>'), // also combinator in child selectors
    GREATER_THAN_OR_EQUAL = new ScssOperator('>='),
    // logical operators
    AND = new ScssOperator('and'),
    OR = new ScssOperator('or'),
    NOT = new ScssOperator('not'),
    // symbols in selectors (combinators)
    TILDE = new ScssSymbol('~'), // in generals sibling selectors
    LBRACKET = new ScssSymbol('['), // in attribute selectors
    RBRACKET = new ScssSymbol(']'),
    IS = new ScssSymbol('='), // in exact attribute value selectors
    HAS = new ScssSymbol('~='), // in partial attribute value selectors
    BEGINS_WITH = new ScssSymbol('^='), // in beginning substring attribute value selectors
    ENDS_WITH = new ScssSymbol('$='), // in ending substring attribute value selectors
    CONTAINS = new ScssSymbol('*='), // in arbitrary substring attribute value selectors
    HAS_LANG = new ScssSymbol('|='), // in language attribute selectors
    // misc.
    AMPERSAND = new ScssSymbol('&'),
    HASH = new ScssSymbol('#'); // a color, an interpolation, also in ID selectors

var Tokenizer = defineClass(function(data) {
    var size = data.length,
        line = 1,
        lastLine = -1,
        column = 0,
        lastColumn = -1,
        pos = 0,
        lastToken = BOF,
        lastChar = null,
        currentChar = null,
        buffer = [];

    function getChar() {
        if (pos >= size) return null;
        lastChar = currentChar;
        currentChar = data[pos++];
        if (currentChar === '\n') {
            line++;
            column = 0;
        }
        else {
            column++;
        }
        return currentChar;
    }

    function peekChar(offset) {
        if (pos >= size) return null;
        return data[pos + (offset || 0)];
    }

    function singleLineComment() { // TODO: interpolated comment
        var commentStart = pos - 1, c;
        getChar(); // skip the second '/'
        for (c = getChar(); c && (c !== '\n'); c = getChar());
        return new ScssComment(data.substring(commentStart, pos), COMMENT_SINGLELINE);
    }

    function multiLineComment() { // TODO: interpolated comment
        var commentStart = pos - 1, c;
        getChar(); // skip the '*'
        c = getChar();
        while (c) {
            if (c === '*') {
                c = getChar();
                if (!c) break;
                if (c === '/') {
                    return new ScssComment(data.substring(commentStart, pos), COMMENT_MULTILINE);
                }
            }
            c = getChar();
        }
        throw new ParseError(lastLine, lastColumn, 'Unterminated comment');
    }

    function numberOrDimension() {
        // by now we are assured that there will be a digit there somewhere
        var isNegative = currentChar === '-',
            n, c;
        if (isNegative) {
            while (isSpace(getChar()));
        }
        n = +currentChar; // first digit
        while (isDigit(c = peekChar())) {
            n = (n * 10) + (+getChar());
        }
        // we got the number, now see how to proceed
        if (isAlpha(c)) {
            // a unit follows, therefore what we have here is a dimension
            buffer.push(getChar());
            while (isAlpha(c = peekChar())) buffer.push(getChar());
            c = buffer.join('').toLowerCase();
            buffer.length = 0;
            if (!isUnit(c)) throw new ParseError(lastLine, lastColumn, 'Unknown unit: ' + c);
            return new ScssDimension(n, c);
        }
        return new ScssNumber(n);
    }

    function primitiveOrInterpolatedString() {
        var realLastLine = lastLine,
            realLastColumn = lastColumn,
            quote = currentChar,
            tokenList, t, expr;

        function primitiveString() {
            var result;
            while (pos < size) {
                if (!currentChar || (currentChar === '\n')) throw new ParseError(realLastLine, realLastColumn, 'Unterminated string');
                if (currentChar === '\\') { // escape character
                    if (getChar() !== '\n') { // not a line continuation?
                        buffer.push(currentChar); // include the character verbatim
                    }
                    continue;
                }
                if (currentChar === quote) break; // string end
                if ((currentChar === '#') && (peekChar() === '{')) break; // interpolation start
                buffer.push(currentChar);
            }
            result = buffer.join('');
            buffer.length = 0;
            return new ScssPrimitiveString(result);
        }

        getChar(); // skip the starting quote
        // first try to assemble a primitive string
        t = primitiveString();
        if (currentChar === quote) return t; // no interpolation inside this string
        // assemble an interpolated string, consisting of a list of primitive strings separated by expressions
        tokenList = [t];
        getChar(); // skip the '{'
        expr = [];
        while (t = nextToken()) {
            if (t === RBRACE) {
                tokenList.push(expr);
                t = primitiveString();
                tokenList.push(t);
                if (currentChar === quote) return new ScssInterpolatedString(tokenList);
                expr = [];
            }
            else {
                expr.push(t);
            }
        }
        throw new ParseError(realLastLine, realLastColumn, 'Unterminated string interpolation');
    }

    function nextToken() {
        var c, i;
        if (pos >= size) return null;
        lastColumn = column;
        lastLine = line;
        if (isSpace(getChar())) {
            buffer.push(currentChar);
            while (isSpace(peekChar())) buffer.push(getChar());
            c = buffer.join('');
            buffer.length = 0;
            return new ScssWhitespace(c);
        }
        switch (currentChar) {
            case '\'':
            case '"': return primitiveOrInterpolatedString();
            case '{': return LBRACE;
            case '}': return RBRACE;
            case '(': return LPAREN;
            case ')': return RPAREN;
            case '[': return LBRACKET;
            case ']': return RBRACKET;
            case ':': return COLON;
            case ';': return SEMICOLON;
            case ',': return COMMA;
            case '+': return PlUS;
            case '*':
                if (peekChar() === '=') {
                    getChar();
                    return CONTAINS;
                }
                return ASTERISK;
            case '%': return PERCENT;
            case '&': return AMPERSAND;
            case '<':
                if (peekChar() === '=') {
                    getChar();
                    return LESS_THAN_OR_EQUAL;
                }
                return LESS_THAN;
            case '>':
                if (peekChar() === '=') {
                    getChar();
                    return GREATER_THAN_OR_EQUAL;
                }
                return GREATER_THAN;
            case '=':
                if (peekChar() === '=') {
                    getChar();
                    return EQUAL;
                }
                return IS;
            case '-':
                c = peekChar();
                if (!lastToken.isLiteral) {
                    // it can only be an unary negation
                    i = 0;
                    while (c && isSpace(c)) c = peekChar(++i); // skip any space
                    if (isDigit(c)) return numberOrDimension(); // a negative number or dimension literal
                    return NEGATION; // negation of a variable
                }
                if (isSpace(c)) return MINUS; // subtraction
                if (isDigit(c)) {
                    if (isSpace(lastChar)) return numberOrDimension(); // a list having this negative number or dimension
                    return MINUS; // subtraction, a minus with no space on either side
                }
                return MINUS; // subtraction of a variable
            case '/':
                c = peekChar();
                if (c === '/') return singleLineComment();
                if (c === '*') return multiLineComment();
                return SLASH;
            case '#':
                // can be either a color or an interpolation or an ID selector // TODO
                break;
            case '!':
                c = peekChar();
                if (c === '=') {
                    getChar();
                    return NOT_EQUAL;
                }
                // TODO: a flag, !default or !important
                break;
            default:
                // identifier // TODO
        }
    }

    return {
        next: function() {
            var token = nextToken();
            if (!token.isComment && !token.isWhitespace) lastToken = token; // needed to determine context of the minus sign
            // TODO
        },
        lastColumn: function() { return lastColumn; },
        lastLine: function() { return lastLine; }
    };
});

exports.Tokenizer = Tokenizer;
