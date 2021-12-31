const abro = (() => {
  const uniqueId = (() => {
    let nextId = 0;
    return (prefix = '') => `${prefix}${nextId++}`;
  })();

  const assert = (cond, message) => {
    if (!cond) {
      console.error(message);
      throw new Error(message);
    }
  };

  const log = (...args) => {
    console.log(currentFiber.name, ...args);
  };

  let currentFiber;

  class FiberTermination extends Error {}

  class Fiber {
    constructor(fn) {
      this.name = uniqueId('fiber');
      if (fn.name) {
        this.name += `-${fn.name}`;
      }
      this._fn = fn;
      this._children = [];
      this._promises = [];
      this.state = 'READY';
    }

    async run() {
      currentFiber = this;
      this.state = 'RUNNING';
      return this._fn().catch(() => {
        if (err instanceof FiberTermination) {
          console.log(err.message);
        } else {
          console.error(err);
        }
      });
      // TODO: Should we restore the previous value of currentFiber here?
      // TODO: Should we clear this._children and this._promises here?
    }

    createChild(fn) {
      const child = new Fiber(fn);
      this._children.push(child);
      return child;
    }

    // Spawn a child fiber.
    spawn(fn) {
      return this.spawnMany([fn]);
    }

    // Spawn multiple child fibers.
    async spawnMany(fns, join = false) {
      const fibers = fns.map((fn) => this.createChild(fn));
      if (join) {
        await Promise.all(fibers.map((f) => f.run()));
      } else {
        await Promise.any(fibers.map((f) => f.run()));
        fibers.forEach((f) => f.terminate());
      }
      currentFiber = this;
    }

    _await(entry) {
      this._promises.push(entry);
      return entry.promise;
    }

    terminate() {
      this.state = 'TERMINATED';

      // Reject all of the promises created from within this fiber.
      this._promises.forEach(({ fiber, reject, eventType, resolved }) => {
        reject(new FiberTermination(`${fiber.name} terminated`));
      });
      this._promises = [];

      // Terminate all child fibers.
      for (const child of this._children) {
        child.terminate();
      }
    }
  }

  class EventSource {
    _promisesByEventType = new Map();

    constructor(domNode) {
      ['mousedown', 'mouseup', 'mousemove', 'keydown'].forEach((eventType) => {
        this._promisesByEventType.set(eventType, []);
        Object.defineProperty(this, eventType, {
          get: () => this._promiseForEvent(eventType)
        });
        domNode.addEventListener(eventType, (evt) => {
          // Save the current list of promises and reset the list, because as
          // soon as we start resolving, new ones can get enqueued.
          const promises = this._promisesByEventType.get(eventType);
          this._promisesByEventType.set(eventType, []);

          // Resolve the promises for all processes waiting on this event.
          promises.forEach(({ fiber, resolve }) => {
            // TODO: Fix leak where terminated fibers still appear in this list.
            if (fiber.state === 'RUNNING') {
              queueMicrotask(() => {
                currentFiber = fiber;
              });
              resolve(evt);
            }
          });
        });
      });
    }

    // Returns a promise that will be resolved when the next event of type
    // `eventType` occurs.
    _promiseForEvent(eventType) {
      assert(this._promisesByEventType.has(eventType), `not supported: ${eventType}`);

      let entry = { fiber: currentFiber, eventType, resolved: false };
      entry.promise = new Promise((res, rej) => {
        entry.resolve = (val) => {
          entry.resolved = true;
          return res(val);
        };
        entry.reject = rej;
      });
      this._promisesByEventType.get(eventType).push(entry);
      return currentFiber._await(entry);
    }
  }

  function or(...fns) {
    return currentFiber.spawnMany(fns);
  }

  function and(...fns) {
    return currentFiber.spawnMany(fns, true);
  }

  function run(fn) {
    return new Fiber(fn).run();
  }

  function loop(fn) {
    let canceled = false;
    (async function run() {
      while (!canceled) {
        await new Fiber(fn).run();
      }
    })();
    return () => {
      canceled = true;
    };
  }

  return {
    EventSource,
    or,
    and,
    run,
    loop,
    log
  };
})();
