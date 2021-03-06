const EventEmitter = require('events');
const BaseCommandLoader = require('./_base-loader.js');
const Utils = require('../util/utils.js');

class CommandLoader extends BaseCommandLoader {

  static get interfaceMethods() {
    return {
      command: 'function'
    };
  }

  static isDeprecatedCommandStyle(CommandModule) {
    return Utils.isObject(CommandModule) && Utils.isFunction(CommandModule.command);
  }

  /**
   * This is to support backwards-compatibility for commands defined as objects,
   *  with a command() property
   *
   * @param CommandModule
   */
  static createFromObject(CommandModule) {
    return class CommandClass extends EventEmitter {
      command(...args) {
        setImmediate(() => {
          CommandModule.command.apply(this.api, args);
        });

        return this.api;
      }
    };
  }

  static createInstance(nightwatchInstance, CommandModule, opts) {
    const CommandClass = CommandLoader.isDeprecatedCommandStyle(CommandModule) ? CommandLoader.createFromObject(CommandModule) : CommandModule;

    class CommandInstance extends CommandClass {
      get api() {
        return nightwatchInstance.api;
      }

      /**
       * @deprecated
       */
      get client() {
        return nightwatchInstance;
      }

      toString() {
        return `${this.constructor.name} [name=${opts.commandName}]`;
      }

      complete(...args) {
        if (Utils.isFunction(super.complete)) {
          return super.complete(...args);
        }

        this.emit('complete', ...args);
      }
    }

    const instance = new CommandInstance();

    Object.keys(CommandLoader.interfaceMethods).forEach(method => {
      let type = CommandLoader.interfaceMethods[method];
      if (!BaseCommandLoader.isTypeImplemented(instance, method, type)) {
        throw new Error(`Command class must implement method .${method}()`);
      }
    });

    instance.stackTrace = opts.stackTrace;
    instance.needsPromise = CommandLoader.isDeprecatedCommandStyle(CommandModule);

    return instance;
  }

  createWrapper() {
    if (this.module) {
      this.commandFn = function commandFn(...args) {
        const instance = CommandLoader.createInstance(this.nightwatchInstance, this.module, {
          stackTrace: commandFn.stackTrace,
          commandName: this.commandName
        });

        this.resolveElementSelector(args)
          .then(elementResult => {
            if (elementResult) {
              args[0] = elementResult;
            }

            return instance.command(...args);
          })
          .catch(err => {
            instance.emit('error', err);
          });

        return instance;
      };
    }

    return this;
  }

  define(parent = null) {
    if (!this.commandFn) {
      return this;
    }

    this.validateMethod(parent);

    const commandName = this.commandName;
    const args = [function commandFn(...args) {
      let originalStackTrace = CommandLoader.getOriginalStackTrace(commandFn);
      const deferred = Utils.createPromise();
      const node = this.commandQueue.add({
        commandName,
        commandFn: this.commandFn,
        context: this,
        args,
        originalStackTrace,
        namespace,
        deferred,
        isES6Async: this.nightwatchInstance.isES6AsyncTestcase
      });

      if (this.nightwatchInstance.isES6AsyncTestcase) {
        return node.deferred.promise;
      }

      return this.api;
    }.bind(this)];

    const namespace = this.getTargetNamespace(parent);

    if (namespace) {
      args.unshift(namespace);
    }

    this.nightwatchInstance.setApiMethod(this.commandName, ...args);
    if (this.module && this.module.AliasName) {
      this.nightwatchInstance.setApiMethod(this.module.AliasName, ...args);
    }

    return this;
  }
}

module.exports = CommandLoader;
