const abro = (() => {
  let currentFiber;

  const assert = (cond, message) => {
    if (!cond) throw new Error(message);
  };

  class Fiber {
    constructor(fn) {
      this._fn = fn;
      this._children = [];
      this._promises = [];
    }

    async run() {
      currentFiber = this;
      await this._fn();
      // TODO: Should we restore the previous value of currentFiber here?
      // TODO: Should we clear this._children and this._promises here?
    }

    createChild(fn) {
      const child = new Fiber(fn);
      this._children.push(child);
      return child;
    }

    // Spawn a child fiber.
    async spawn(fn) {
      await this.spawnMany([fn]);
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

    async _await(entry) {
      this._promises.push(entry);
      const val = await entry.promise;
      currentFiber = this;
      return val;
    }

    terminate() {
      // Reject all of the promises created from within this fiber.
      this._promises.forEach(({ reject }) => reject());
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
          // If any process is waiting on this event, resolve the promise so
          // process can continue.
          for (const { resolve } of this._promisesByEventType.get(eventType)) {
            resolve(evt);
          }
          this._promisesByEventType.set(eventType, []);
        });
      });
    }

    // Returns a promise that will be resolved when the next event of type
    // `eventType` occurs.
    _promiseForEvent(eventType) {
      assert(this._promisesByEventType.has(eventType), `not supported: ${eventType}`);

      let entry = {};
      entry.promise = new Promise((res, rej) => {
        entry.resolve = res;
        entry.reject = rej;
      });
      this._promisesByEventType.get(eventType).push(entry);
      return currentFiber._await(entry);
    }
  }

  async function or(...fns) {
    await currentFiber.spawnMany(fns);
  }

  async function and(...fns) {
    await currentFiber.spawnMany(fns, true);
  }

  async function run(fn) {
    await new Fiber(fn).run();
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

  return { EventSource, or, and, run, loop };
})();
