import * as types from "babel-types";
import {
  ErrInvalidIterable,
  ErrNoSuper,
  ErrNotDefined,
  ErrNotSupport,
  ErrUnexpectedToken
} from "./error";
import { Path } from "./path";
import {
  __generator,
  _classCallCheck,
  _createClass,
  _inherits,
  _possibleConstructorReturn,
  _taggedTemplateLiteral,
  _toConsumableArray
} from "./runtime";
import { IVar, Var } from "./var";
// tslint:disable-next-line
import { EvaluateFunc, EvaluateMap, Kind } from "./type";
// tslint:disable-next-line
import { Signal } from "./signal";
import { Scope } from "./scope";

import {
  isArrayExpression,
  isArrayPattern,
  isAssignmentPattern,
  isCallExpression,
  isClassMethod,
  isClassProperty,
  isFunctionDeclaration,
  isIdentifier,
  isImportDefaultSpecifier,
  isImportSpecifier,
  isMemberExpression,
  isObjectExpression,
  isObjectPattern,
  isObjectProperty,
  isRestElement,
  isSpreadElement,
  isVariableDeclaration
} from "./packages/babel-types";

const visitors: EvaluateMap = {
  File(path) {
    evaluate(path.createChild(path.node.program));
  },
  Program(path) {
    const { node: program, scope } = path;
    // hoisting
    for (const node of program.body) {
      if (isFunctionDeclaration(node)) {
        evaluate(path.createChild(node));
      } else if (isVariableDeclaration(node)) {
        for (const declaration of node.declarations) {
          if (node.kind === "var") {
            scope.var((declaration.id as types.Identifier).name, undefined);
          }
        }
      }
    }

    for (const node of program.body) {
      if (!isFunctionDeclaration(node)) {
        evaluate(path.createChild(node));
      }
    }
  },

  Identifier(path) {
    const { node, scope } = path;
    if (node.name === "undefined") {
      return undefined;
    }
    const $var = scope.hasBinding(node.name);
    if ($var) {
      return $var.value;
    } else {
      throw ErrNotDefined(node.name);
    }
  },
  RegExpLiteral(path) {
    const { node } = path;
    return new RegExp(node.pattern, node.flags);
  },
  StringLiteral(path) {
    return path.node.value;
  },
  NumericLiteral(path) {
    return path.node.value;
  },
  BooleanLiteral(path) {
    return path.node.value;
  },
  NullLiteral(path) {
    return null;
  },
  IfStatement(path) {
    const newScope = path.scope.createChild("block");
    newScope.invasive = true;
    if (evaluate(path.createChild(path.node.test, newScope))) {
      return evaluate(path.createChild(path.node.consequent, newScope));
    } else if (path.node.alternate) {
      return evaluate(path.createChild(path.node.alternate, newScope));
    }
  },
  EmptyStatement(path) {
    // do nothing
  },
  BlockStatement(path) {
    const { node: block, scope } = path;

    // hoisting
    for (const node of block.body) {
      if (isFunctionDeclaration(node)) {
        evaluate(path.createChild(node));
      } else if (isVariableDeclaration(node)) {
        for (const declaration of node.declarations) {
          if (node.kind === "var") {
            scope.var((declaration.id as types.Identifier).name, undefined);
          }
        }
      }
    }

    let tempResult;
    for (const node of block.body) {
      const result = (tempResult = evaluate(path.createChild(node, scope)));
      if (result instanceof Signal) {
        return result;
      }
    }
    // to support do-expression
    // anyway, return the last item
    return tempResult;
  },
  WithStatement(path) {
    throw ErrNotSupport(path.node.type);
  },
  DebuggerStatement(path) {
    // tslint:disable-next-line
    debugger;
  },
  LabeledStatement(path) {
    throw ErrNotSupport(path.node.type);
  },
  BreakStatement(path) {
    return new Signal("break");
  },
  ContinueStatement(path) {
    return new Signal("continue");
  },
  ReturnStatement(path) {
    return new Signal(
      "return",
      path.node.argument
        ? evaluate(path.createChild(path.node.argument))
        : undefined
    );
  },
  VariableDeclaration(path) {
    const { node, scope } = path;
    const kind = node.kind;

    for (const declaration of node.declarations) {
      const varKeyValueMap: { [k: string]: any } = {};
      if (isIdentifier(declaration.id)) {
        varKeyValueMap[declaration.id.name] = declaration.init
          ? evaluate(path.createChild(declaration.init))
          : undefined;
      } else if (isObjectPattern(declaration.id)) {
        const vars: Array<{ key: string; alias: string }> = [];
        for (const n of declaration.id.properties) {
          if (isObjectProperty(n)) {
            vars.push({
              key: (n.key as any).name as string,
              alias: (n.value as any).name as string
            });
          }
        }
        const obj = evaluate(path.createChild(declaration.init));

        for (const $var of vars) {
          if ($var.key in obj) {
            varKeyValueMap[$var.alias] = obj[$var.key];
          }
        }
      } else if (isArrayPattern(declaration.id)) {
        // @es2015 destrucuring
        // @flow
        declaration.id.elements.forEach((n, i) => {
          if (isIdentifier(n)) {
            const $varName: string = n.typeAnnotation
              ? (n.typeAnnotation.typeAnnotation as any).id.name
              : n.name;

            if (isArrayExpression(declaration.init)) {
              const el = declaration.init.elements[i];
              if (!el) {
                varKeyValueMap[$varName] = undefined;
              } else {
                const result = evaluate(path.createChild(el));
                varKeyValueMap[$varName] = result;
              }
            } else {
              throw node;
            }
          }
        });
      } else {
        throw node;
      }

      for (const varName in varKeyValueMap) {
        if (scope.invasive && kind === "var") {
          if (scope.parent) {
            scope.parent.declare(kind, varName, varKeyValueMap[varName]);
          } else {
            scope.declare(kind, varName, varKeyValueMap[varName]);
          }
        } else {
          scope.declare(kind, varName, varKeyValueMap[varName]);
        }
      }
    }
  },
  VariableDeclarator: path => {
    const { node, scope } = path;
    // @es2015 destructuring
    if (isObjectPattern(node.id)) {
      const newScope = scope.createChild("block");
      if (isObjectExpression(node.init)) {
        evaluate(path.createChild(node.init, newScope));
      }
      for (const n of node.id.properties) {
        if (isObjectProperty(n)) {
          const propertyName: string = (n as any).id.name;
          const $var = newScope.hasBinding(propertyName);
          const varValue = $var ? $var.value : undefined;
          scope.var(propertyName, varValue);
          return varValue;
        }
      }
    } else if (isObjectExpression(node.init)) {
      const varName: string = (node.id as types.Identifier).name;
      const varValue = evaluate(path.createChild(node.init));
      scope.var(varName, varValue);
      return varValue;
    } else {
      throw node;
    }
  },
  FunctionDeclaration(path) {
    const { node, scope } = path;
    const { name: functionName } = node.id;
    if (node.async === true) {
      // TODO: support async await
    } else if (node.generator) {
      const generatorFunc = function() {
        // tslint:disable-next-line
        const __this = this;

        // tslint:disable-next-line
        function handler(_a) {
          const functionBody = node.body;
          const block = functionBody.body[_a.label];
          // the last block
          if (!block) {
            return [2, undefined];
          }

          const fieldContext = {
            call: false,
            value: null
          };
          function next(value) {
            fieldContext.value = value;
            fieldContext.call = true;
            _a.sent();
          }

          const r = evaluate(path.createChild(block, path.scope, { next }));

          if (Signal.isReturn(r)) {
            return [2, r.value];
          }
          if (fieldContext.call) {
            return [4, fieldContext.value];
          } else {
            // next block
            _a.label++;
            return handler(_a);
          }
        }

        return __generator(__this, handler);
      };
      // function can be duplicate
      scope.var(functionName, generatorFunc);
    } else {
      const func = visitors.FunctionExpression(path.createChild(node as any));

      Object.defineProperties(func, {
        length: { value: node.params.length },
        name: { value: functionName }
      });

      // function declartion can be duplicate
      scope.var(functionName, func);
    }
  },
  ExpressionStatement(path) {
    return evaluate(path.createChild(path.node.expression));
  },
  ForStatement(path) {
    const { node, scope } = path;

    const forScope = scope.createChild("loop");

    forScope.invasive = true; // 有块级作用域

    if (node.init) {
      evaluate(path.createChild(node.init, forScope));
    }

    for (;;) {
      // every loop will create it's own scope
      // it should inherit from forScope
      const loopScope = forScope.fork();

      if (node.test && !evaluate(path.createChild(node.test, forScope))) {
        break;
      }

      const result = evaluate(path.createChild(node.body, loopScope));
      if (Signal.isBreak(result)) {
        break;
      } else if (Signal.isContinue(result)) {
        continue;
      } else if (Signal.isReturn(result)) {
        return result;
      }
      if (node.update) {
        evaluate(path.createChild(node.update, forScope));
      }
    }
  },
  // @es2015 for of
  ForOfStatement(path) {
    const { node, scope } = path;
    const entity = evaluate(path.createChild(node.right));
    // not support for of, it mean not support native for of
    if (typeof Symbol !== "undefined") {
      if (!entity || !entity[Symbol.iterator]) {
        // FIXME: how to get function name
        // for (let value of get()){}
        throw ErrInvalidIterable((node.right as types.Identifier).name);
      }
    }

    if (isVariableDeclaration(node.left)) {
      /**
       * for (let value in array){ // value should define in block scope
       *
       * }
       */
      const declarator: types.VariableDeclarator = node.left.declarations[0];
      const varName = (declarator.id as types.Identifier).name;
      // typescript will compile it to for(){}
      for (const value of entity) {
        const newScope = scope.createChild("loop");
        newScope.invasive = true;
        newScope.declare(node.left.kind, varName, value); // define in current scope
        evaluate(path.createChild(node.body, newScope));
      }
    } else if (isIdentifier(node.left)) {
      /**
       * for (value in array){  // value should define in parent scope
       *
       * }
       */
      const varName = node.left.name;
      for (const value of entity) {
        const newScope = scope.createChild("loop");
        newScope.invasive = true;
        scope.var(varName, value); // define in parent scope
        evaluate(path.createChild(node.body, newScope));
      }
    }
  },
  ForInStatement(path) {
    const { node, scope } = path;
    const kind = (node.left as types.VariableDeclaration).kind;
    const decl = (node.left as types.VariableDeclaration).declarations[0];
    const name = (decl.id as types.Identifier).name;

    const right = evaluate(path.createChild(node.right));

    for (const value in right) {
      if (Object.hasOwnProperty.call(right, value)) {
        const newScope = scope.createChild("loop");
        newScope.invasive = true;

        newScope.declare(kind, name, value);

        const result = evaluate(path.createChild(node.body, newScope));
        if (Signal.isBreak(result)) {
          break;
        } else if (Signal.isContinue(result)) {
          continue;
        } else if (Signal.isReturn(result)) {
          return result;
        }
      }
    }
  },
  DoWhileStatement(path) {
    const { node, scope } = path;
    // do while don't have his own scope
    do {
      const newScope = scope.createChild("loop");
      newScope.invasive = true; // do while循环具有侵入性，定义var的时候，是覆盖父级变量
      const result = evaluate(path.createChild(node.body, newScope)); // 先把do的执行一遍
      if (Signal.isBreak(result)) {
        break;
      } else if (Signal.isContinue(result)) {
        continue;
      } else if (Signal.isReturn(result)) {
        return result;
      }
    } while (evaluate(path.createChild(node.test)));
  },
  WhileStatement(path) {
    const { node, scope } = path;
    while (evaluate(path.createChild(node.test))) {
      const newScope = scope.createChild("loop");
      newScope.invasive = true;
      const result = evaluate(path.createChild(node.body, newScope));

      if (Signal.isBreak(result)) {
        break;
      } else if (Signal.isContinue(result)) {
        continue;
      } else if (Signal.isReturn(result)) {
        return result;
      }
    }
  },
  ThrowStatement(path) {
    throw evaluate(path.createChild(path.node.argument));
  },
  CatchClause(path) {
    return evaluate(path.createChild(path.node.body));
  },
  TryStatement(path) {
    const { node, scope } = path;
    try {
      const newScope = scope.createChild("block");
      newScope.invasive = true;
      return evaluate(path.createChild(node.block, newScope));
    } catch (err) {
      if (node.handler) {
        const param = node.handler.param as types.Identifier;
        const newScope = scope.createChild("block");
        newScope.invasive = true;
        newScope.const(param.name, err);
        return evaluate(path.createChild(node.handler, newScope));
      } else {
        throw err;
      }
    } finally {
      if (node.finalizer) {
        const newScope = scope.createChild("block");
        newScope.invasive = true;
        evaluate(path.createChild(node.finalizer, newScope));
      }
    }
  },
  SwitchStatement(path) {
    const { node, scope } = path;
    const discriminant = evaluate(path.createChild(node.discriminant)); // switch的条件
    const newScope = scope.createChild("switch");
    newScope.invasive = true;

    let matched = false;
    for (const $case of node.cases) {
      // 进行匹配相应的 case
      if (
        !matched &&
        (!$case.test ||
          discriminant === evaluate(path.createChild($case.test, newScope)))
      ) {
        matched = true;
      }

      if (matched) {
        const result = evaluate(path.createChild($case, newScope));

        if (Signal.isBreak(result)) {
          break;
        } else if (Signal.isContinue(result)) {
          continue;
        } else if (Signal.isReturn(result)) {
          return result;
        }
      }
    }
  },
  SwitchCase(path) {
    const { node } = path;
    for (const stmt of node.consequent) {
      const result = evaluate(path.createChild(stmt));
      if (result instanceof Signal) {
        return result;
      }
    }
  },
  UpdateExpression(path) {
    const { node, scope } = path;
    const { prefix } = node;
    let $var;
    if (isIdentifier(node.argument)) {
      const { name } = node.argument;
      $var = scope.hasBinding(name);
      if (!$var) {
        throw new Error(`${name} 未定义`);
      }
    } else if (isMemberExpression(node.argument)) {
      const argument = node.argument;
      const object = evaluate(path.createChild(argument.object));
      const property = argument.computed
        ? evaluate(path.createChild(argument.property))
        : (argument.property as types.Identifier).name;
      $var = {
        set(value: any) {
          object[property] = value;
          return true;
        },
        get value() {
          return object[property];
        }
      };
    }

    return {
      "--": v => {
        $var.set(v - 1);
        return prefix ? --v : v--;
      },
      "++": v => {
        $var.set(v + 1);
        return prefix ? ++v : v++;
      }
    }[node.operator](evaluate(path.createChild(node.argument)));
  },
  ThisExpression(path) {
    const { scope } = path;
    // use this in class constructor it it never call super();
    if (scope.type === "class") {
      if (!scope.hasOwnBinding("this")) {
        throw ErrNoSuper();
      }
    }
    const thisVar = scope.hasBinding("this");
    return thisVar ? thisVar.value : null;
  },
  ArrayExpression(path) {
    const { node } = path;
    let newArray: any[] = [];
    for (const item of node.elements) {
      if (item === null) {
        newArray.push(undefined);
      } else if (isSpreadElement(item)) {
        const arr = evaluate(path.createChild(item));
        newArray = ([] as any[]).concat(newArray, _toConsumableArray(arr));
      } else {
        newArray.push(evaluate(path.createChild(item)));
      }
    }
    return newArray;
  },
  ObjectExpression(path) {
    const { node, scope } = path;
    const object = {};
    const newScope = scope.createChild("block");
    const computedProperties: Array<
      types.ObjectProperty | types.ObjectMethod
    > = [];

    for (const property of node.properties) {
      const tempProperty = property as
        | types.ObjectMethod
        | types.ObjectProperty;
      if (tempProperty.computed === true) {
        computedProperties.push(tempProperty);
        continue;
      }
      evaluate(path.createChild(property, newScope, { object }));
    }

    // eval the computed properties
    for (const property of computedProperties) {
      evaluate(path.createChild(property, newScope, { object }));
    }

    return object;
  },
  ObjectProperty(path) {
    const { node, scope, ctx } = path;
    const { object } = ctx;
    const val = evaluate(path.createChild(node.value));
    if (isIdentifier(node.key)) {
      object[node.key.name] = val;
      scope.const(node.key.name, val);
    } else {
      object[evaluate(path.createChild(node.key))] = val;
    }
  },
  ObjectMethod(path) {
    const { node, scope } = path;
    const methodName: string = !node.computed
      ? isIdentifier(node.key)
        ? node.key.name
        : evaluate(path.createChild(node.key))
      : evaluate(path.createChild(node.key));
    const method = function() {
      const args = [].slice.call(arguments);
      const newScope = scope.createChild("function");
      newScope.const("this", this);
      // define argument
      node.params.forEach((param, i) => {
        if (isIdentifier(param)) {
          newScope.const(param.name, args[i]);
        } else {
          throw node;
        }
      });
      const result = evaluate(path.createChild(node.body, newScope));
      if (Signal.isReturn(result)) {
        return result.value;
      }
    };
    Object.defineProperties(method, {
      length: { value: node.params.length },
      name: { value: methodName }
    });
    switch (node.kind) {
      case "get":
        Object.defineProperty(path.ctx.object, methodName, { get: method });
        scope.const(methodName, method);
        break;
      case "set":
        Object.defineProperty(path.ctx.object, methodName, { set: method });
        break;
      case "method":
        Object.defineProperty(path.ctx.object, methodName, { value: method });
        break;
      default:
        throw new Error("Invalid kind of property");
    }
  },
  FunctionExpression(path) {
    const { node, scope } = path;
    const func = function functionDeclaration(...args) {
      const newScope = scope.createChild("function");
      for (let i = 0; i < node.params.length; i++) {
        const param = node.params[i];
        if (isIdentifier(param)) {
          newScope.const(param.name, args[i]);
        } else if (isAssignmentPattern(param)) {
          // @es2015 default parameters
          evaluate(path.createChild(param, newScope, { value: args[i] }));
        } else if (isRestElement(param)) {
          // @es2015 rest parameters
          evaluate(path.createChild(param, newScope, { value: args.slice(i) }));
        }
      }
      newScope.const("this", this);
      newScope.const("arguments", arguments);
      const result = evaluate(path.createChild(node.body, newScope));
      if (result instanceof Signal) {
        return result.value;
      } else {
        return result;
      }
    };

    Object.defineProperties(func, {
      length: {
        value: node.params.length
      },
      name: {
        value: node.id ? node.id.name : "" // Anonymous function
      }
    });

    return func;
  },
  BinaryExpression(path) {
    const { node } = path;
    return {
      // tslint:disable-next-line
      "==": (a, b) => a == b,
      // tslint:disable-next-line
      "!=": (a, b) => a != b,
      "===": (a, b) => a === b,
      "!==": (a, b) => a !== b,
      "<": (a, b) => a < b,
      "<=": (a, b) => a <= b,
      ">": (a, b) => a > b,
      ">=": (a, b) => a >= b,
      // tslint:disable-next-line
      "<<": (a, b) => a << b,
      // tslint:disable-next-line
      ">>": (a, b) => a >> b,
      // tslint:disable-next-line
      ">>>": (a, b) => a >>> b,
      "+": (a, b) => a + b,
      "-": (a, b) => a - b,
      "*": (a, b) => a * b,
      "/": (a, b) => a / b,
      "%": (a, b) => a % b,
      // tslint:disable-next-line
      "|": (a, b) => a | b,
      // tslint:disable-next-line
      "^": (a, b) => a ^ b,
      // tslint:disable-next-line
      "&": (a, b) => a & b,
      "**": (a, b) => Math.pow(a, b),
      in: (a, b) => a in b,
      instanceof: (a, b) => a instanceof b
    }[node.operator](
      evaluate(path.createChild(node.left)),
      evaluate(path.createChild(node.right))
    );
  },
  UnaryExpression(path) {
    const { node, scope } = path;
    return {
      "-": () => -evaluate(path.createChild(node.argument)),
      "+": () => +evaluate(path.createChild(node.argument)),
      "!": () => !evaluate(path.createChild(node.argument)),
      // tslint:disable-next-line
      "~": () => ~evaluate(path.createChild(node.argument)),
      void: () => void evaluate(path.createChild(node.argument)),
      typeof: (): string => {
        if (isIdentifier(node.argument)) {
          const $var = scope.hasBinding(node.argument.name);
          return $var ? typeof $var.value : "undefined";
        } else {
          return typeof evaluate(path.createChild(node.argument));
        }
      },
      delete: () => {
        if (isMemberExpression(node.argument)) {
          const { object, property, computed } = node.argument;
          if (computed) {
            return delete evaluate(path.createChild(object))[
              evaluate(path.createChild(property))
            ];
          } else {
            return delete evaluate(path.createChild(object))[
              (property as types.Identifier).name
            ];
          }
        } else if (isIdentifier(node.argument)) {
          const $this = scope.hasBinding("this");
          if ($this) {
            return $this.value[node.argument.name];
          }
        }
      }
    }[node.operator]();
  },

  CallExpression(path) {
    const { node, scope } = path;
    const func = evaluate(path.createChild(node.callee));
    const args = node.arguments.map(arg => evaluate(path.createChild(arg)));

    if (isMemberExpression(node.callee)) {
      const object = evaluate(path.createChild(node.callee.object));
      return func.apply(object, args);
    } else {
      const thisVar = scope.hasBinding("this");
      return func.apply(thisVar ? thisVar.value : null, args);
    }
  },
  MemberExpression(path) {
    const { node } = path;
    const { object, property, computed } = node;

    const propertyName: string = computed
      ? evaluate(path.createChild(property))
      : (property as types.Identifier).name;

    const obj = evaluate(path.createChild(object));
    const target = obj[propertyName];

    return typeof target === "function" ? target.bind(obj) : target;
  },
  AssignmentExpression(path) {
    const { node, scope } = path;
    let $var: IVar;

    if (isIdentifier(node.left)) {
      const { name } = node.left;
      const varOrNot = scope.hasBinding(name);

      if (!varOrNot) {
        // here to define global var
        const globalScope = scope.global;
        globalScope.var(name, evaluate(path.createChild(node.right)));
        const globalVar = globalScope.hasBinding(name);
        if (globalVar) {
          $var = globalVar;
        } else {
          throw ErrNotDefined(name);
        }
      } else {
        $var = varOrNot as Var<any>;
        /**
         * const test = 123;
         * test = 321 // it should throw an error
         */
        if ($var.kind === "const") {
          throw new TypeError("Assignment to constant variable.");
        }
      }
    } else if (isMemberExpression(node.left)) {
      const left = node.left;
      const object: any = evaluate(path.createChild(left.object));
      const property: string = left.computed
        ? evaluate(path.createChild(left.property))
        : (left.property as types.Identifier).name;
      $var = {
        kind: "var",
        set(value: any) {
          object[property] = value;
        },
        get value() {
          return object[property];
        }
      };
    } else {
      throw ErrUnexpectedToken();
    }

    return {
      "=": v => {
        $var.set(v);
        return v;
      },
      "+=": v => {
        $var.set($var.value + v);
        return $var.value;
      },
      "-=": v => {
        $var.set($var.value - v);
        return $var.value;
      },
      "*=": v => {
        $var.set($var.value * v);
        return $var.value;
      },
      "/=": v => {
        $var.set($var.value / v);
        return $var.value;
      },
      "%=": v => {
        $var.set($var.value % v);
        return $var.value;
      },
      "<<=": v => {
        // tslint:disable-next-line: no-bitwise
        $var.set($var.value << v);
        return $var.value;
      },
      ">>=": v => {
        // tslint:disable-next-line: no-bitwise
        $var.set($var.value >> v);
        return $var.value;
      },
      ">>>=": v => {
        // tslint:disable-next-line: no-bitwise
        $var.set($var.value >>> v);
        return $var.value;
      },
      "|=": v => {
        // tslint:disable-next-line: no-bitwise
        $var.set($var.value | v);
        return $var.value;
      },
      "^=": v => {
        // tslint:disable-next-line: no-bitwise
        $var.set($var.value ^ v);
        return $var.value;
      },
      "&=": v => {
        // tslint:disable-next-line: no-bitwise
        $var.set($var.value & v);
        return $var.value;
      }
    }[node.operator](evaluate(path.createChild(node.right)));
  },
  LogicalExpression(path) {
    const { node } = path;
    return {
      "||": () =>
        evaluate(path.createChild(node.left)) ||
        evaluate(path.createChild(node.right)),
      "&&": () =>
        evaluate(path.createChild(node.left)) &&
        evaluate(path.createChild(node.right))
    }[node.operator]();
  },
  ConditionalExpression(path) {
    return evaluate(path.createChild(path.node.test))
      ? evaluate(path.createChild(path.node.consequent))
      : evaluate(path.createChild(path.node.alternate));
  },
  NewExpression(path) {
    const { node } = path;
    const func = evaluate(path.createChild(node.callee));
    const args: any[] = node.arguments.map(arg =>
      evaluate(path.createChild(arg))
    );
    const entity = new func(...args);
    entity.prototype = entity.prototype || {};
    entity.prototype.constructor = func;
    return entity;
  },

  // ES2015
  ArrowFunctionExpression(path) {
    const { node, scope } = path;
    const func = (...args) => {
      const newScope = scope.createChild("function");
      for (let i = 0; i < node.params.length; i++) {
        const { name } = node.params[i] as types.Identifier;
        newScope.const(name, args[i]);
      }

      const lastThis = scope.hasBinding("this");

      newScope.const("this", lastThis ? lastThis.value : null);
      newScope.const("arguments", args);
      const result = evaluate(path.createChild(node.body, newScope));

      if (result instanceof Signal) {
        return result.value;
      } else {
        return result;
      }
    };

    Object.defineProperties(func, {
      length: { value: node.params.length },
      name: { value: node.id ? node.id.name : "" }
    });

    return func;
  },
  TemplateLiteral(path) {
    const { node } = path;
    return ([] as types.Node[])
      .concat(node.expressions, node.quasis)
      .sort((a, b) => a.start - b.start)
      .map(element => evaluate(path.createChild(element)))
      .join("");
  },
  TemplateElement(path) {
    return path.node.value.raw;
  },
  ClassDeclaration(path) {
    const ClassConstructor = evaluate(
      path.createChild(path.node.body, path.scope.createChild("class"))
    );
    path.scope.const(path.node.id.name, ClassConstructor);
  },
  ClassBody(path) {
    const { node, scope } = path;
    const constructor: types.ClassMethod | void = node.body.find(
      n => isClassMethod(n) && n.kind === "constructor"
    ) as types.ClassMethod | void;
    const methods: types.ClassMethod[] = node.body.filter(
      n => isClassMethod(n) && n.kind !== "constructor"
    ) as types.ClassMethod[];
    const properties: types.ClassProperty[] = node.body.filter(n =>
      isClassProperty(n)
    ) as types.ClassProperty[];

    const parentNode = (path.parent as Path<types.ClassDeclaration>).node;

    const Class = (SuperClass => {
      if (SuperClass) {
        _inherits(ClassConstructor, SuperClass);
      }

      function ClassConstructor(...args) {
        _classCallCheck(this, ClassConstructor);
        const classScope = scope.createChild("class");

        // define class property
        properties.forEach(p => {
          this[p.key.name] = evaluate(path.createChild(p.value, classScope));
        });

        if (constructor) {
          // defined the params
          constructor.params.forEach((p: types.LVal, i) => {
            if (isIdentifier(p)) {
              classScope.const(p.name, args[i]);
            } else {
              throw new Error("Invalid params");
            }
          });

          if (!SuperClass) {
            classScope.const("this", this);
          }

          for (const n of constructor.body.body) {
            evaluate(
              path.createChild(n, classScope, {
                SuperClass,
                ClassConstructor,
                ClassConstructorArguments: args,
                ClassEntity: this,
                classScope
              })
            );
          }
        } else {
          classScope.const("this", this);
          // apply super if constructor not exist
          _possibleConstructorReturn(
            this,
            (
              (ClassConstructor as any).__proto__ ||
              Object.getPrototypeOf(ClassConstructor)
            ).apply(this, args)
          );
        }

        if (!classScope.hasOwnBinding("this")) {
          throw ErrNoSuper();
        }

        return this;
      }

      // define class name
      Object.defineProperties(ClassConstructor, {
        name: { value: parentNode.id.name },
        length: { value: constructor ? constructor.params.length : 0 }
      });

      const classMethods = methods
        .map((method: types.ClassMethod) => {
          const newScope = scope.createChild("function");
          const func = function(...args) {
            newScope.var("this", this);

            // defined the params
            method.params.forEach((p: types.LVal, i) => {
              if (isIdentifier(p)) {
                newScope.const(p.name, args[i]);
              }
            });

            const result = evaluate(
              path.createChild(method.body, newScope, {
                SuperClass,
                ClassConstructor,
                ClassMethodArguments: args,
                ClassEntity: this
              })
            );

            if (Signal.isReturn(result)) {
              return result.value;
            }
          };

          Object.defineProperties(func, {
            length: { value: method.params.length },
            name: { value: method.id ? method.id.name : "" }
          });

          return {
            key: (method.key as any).name,
            [method.kind === "method" ? "value" : method.kind]: func
          };
        })
        .concat([{ key: "constructor", value: ClassConstructor }]);

      // define class methods
      _createClass(ClassConstructor, classMethods);

      return ClassConstructor;
    })(
      parentNode.superClass
        ? (() => {
            const $var = scope.hasBinding((parentNode.superClass as any).name);
            return $var ? $var.value : null;
          })()
        : null
    );

    return Class;
  },
  ClassMethod(path) {
    return evaluate(path.createChild(path.node.body));
  },
  ClassExpression(path) {
    //
  },
  Super(path) {
    const { ctx } = path;
    const { SuperClass, ClassConstructor, ClassEntity } = ctx;
    const classScope: Scope = ctx.classScope;
    const ClassBodyPath = path.$findParent("ClassBody");
    // make sure it include in ClassDeclaration
    if (!ClassBodyPath) {
      throw new Error("super() only can use in ClassDeclaration");
    }
    const parentPath = path.parent;
    if (parentPath) {
      // super()
      if (isCallExpression(parentPath.node)) {
        if (classScope && !classScope.hasOwnBinding("this")) {
          classScope.const("this", ClassEntity);
        }
        return function inherits(...args) {
          _possibleConstructorReturn(
            ClassEntity,
            (
              (ClassConstructor as any).__proto__ ||
              Object.getPrototypeOf(ClassConstructor)
            ).apply(ClassEntity, args)
          );
        }.bind(ClassEntity);
      } else if (isMemberExpression(parentPath.node)) {
        // super.eat()
        // then return the superclass prototype
        return SuperClass.prototype;
      }
    }
  },
  SpreadElement(path) {
    return evaluate(path.createChild(path.node.argument));
  },
  // @experimental Object rest spread
  SpreadProperty(path) {
    const { node, ctx } = path;
    const { object } = ctx;
    Object.assign(object, evaluate(path.createChild(node.argument)));
  },
  ImportDeclaration(path) {
    const { node, scope } = path;
    let defaultImport: string = ""; // default import object
    const otherImport: string[] = []; // import property
    const moduleName: string = evaluate(path.createChild(node.source));
    node.specifiers.forEach(n => {
      if (isImportDefaultSpecifier(n)) {
        defaultImport = visitors.ImportDefaultSpecifier(path.createChild(n));
      } else if (isImportSpecifier(n)) {
        otherImport.push(visitors.ImportSpecifier(path.createChild(n)));
      } else {
        throw n;
      }
    });

    const requireVar = scope.hasBinding("require");

    if (requireVar) {
      const requireFunc = requireVar.value;

      const targetModule: any = requireFunc(moduleName) || {};

      if (defaultImport) {
        scope.const(
          defaultImport,
          targetModule.default ? targetModule.default : targetModule
        );
      }

      otherImport.forEach((varName: string) => {
        scope.const(varName, targetModule[varName]);
      });
    }
  },
  ImportDefaultSpecifier(path) {
    return path.node.local.name;
  },
  ImportSpecifier(path) {
    return path.node.local.name;
  },
  ExportDefaultDeclaration(path) {
    const { node, scope } = path;
    const moduleVar = scope.hasBinding("module");
    if (moduleVar) {
      const moduleObject = moduleVar.value;
      moduleObject.exports = {
        ...moduleObject.exports,
        ...evaluate(path.createChild(node.declaration))
      };
    }
  },
  ExportNamedDeclaration(path) {
    const { node } = path;
    node.specifiers.forEach(n => evaluate(path.createChild(n)));
  },
  ExportSpecifier(path) {
    const { node, scope } = path;
    const moduleVar = scope.hasBinding("module");
    if (moduleVar) {
      const moduleObject = moduleVar.value;
      moduleObject.exports[node.local.name] = evaluate(
        path.createChild(node.local)
      );
    }
  },
  AssignmentPattern(path) {
    const { node, scope, ctx } = path;
    const { value } = ctx;
    scope.const(
      node.left.name,
      value === undefined ? evaluate(path.createChild(node.right)) : value
    );
  },
  RestElement(path) {
    const { node, scope, ctx } = path;
    const { value } = ctx;
    scope.const((node.argument as types.Identifier).name, value);
  },
  YieldExpression(path) {
    const { next } = path.ctx;
    next(evaluate(path.createChild(path.node.argument))); // call next
  },
  SequenceExpression(path) {
    let result;
    for (const expression of path.node.expressions) {
      result = evaluate(path.createChild(expression));
    }
    return result;
  },
  TaggedTemplateExpression(path) {
    const str = path.node.quasi.quasis.map(v => v.value.cooked);
    const raw = path.node.quasi.quasis.map(v => v.value.raw);
    const templateObject = _taggedTemplateLiteral(str, raw);
    const func = evaluate(path.createChild(path.node.tag));
    const expressionResultList =
      path.node.quasi.expressions.map(n => evaluate(path.createChild(n))) || [];
    return func(templateObject, ...expressionResultList);
  },
  MetaProperty(path) {
    //
  },
  AwaitExpression(path) {
    //
  },
  DoExpression(path) {
    const newScope = path.scope.createChild("block");
    newScope.invasive = true;
    return evaluate(path.createChild(path.node.body, newScope));
  }
};

export default function evaluate(path: Path<types.Node>) {
  const visitor: EvaluateFunc = visitors[path.node.type];
  if (!visitor) {
    throw new Error(`Unknown visitors of ${path.node.type}`);
  }
  return visitor(path);
}
