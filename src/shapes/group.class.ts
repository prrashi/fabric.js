//@ts-nocheck

import { stateProperties } from '../constants';
import { CollectionMixinGenerator } from "../mixins/collection.mixin";
import { Point } from "../point.class";
import {
  applyTransformToObject, cos, degreesToRadians, enlivenObjectEnlivables, enlivenObjects, invertTransform, multiplyTransformMatrices, sin, transformPoint
} from '../util';
import { FabricObject } from "./object.class";
import { Rect } from "./rect.class";

/**
 * Group class
 * @class Group
 * @extends FabricObject
 * @mixes Collection
 * @fires layout once layout completes
 */
export class Group extends CollectionMixinGenerator(FabricObject) {

  /**
   * Type of an object
   * @type string
   * @default
   */
  type: string = 'group'

  /**
   * Specifies the **layout strategy** for instance
   * Used by `getLayoutStrategyResult` to calculate layout
   * `fit-content`, `fit-content-lazy`, `fixed`, `clip-path` are supported out of the box
   * @type string
   * @default
   */
  layout: string = 'fit-content'

  /**
   * Width of stroke
   * @type Number
   */
  strokeWidth: number = 0

  /**
   * List of properties to consider when checking if state
   * of an object is changed (Object#hasStateChanged)
   * as well as for history (undo/redo) purposes
   * @type string[]
   */
  stateProperties: string[] = stateProperties.concat('layout')

  /**
   * Used to optimize performance
   * set to `false` if you don't need contained objects to be targets of events
   * @default
   * @type boolean
   */
  subTargetCheck: boolean = false

  /**
   * Used to allow targeting of object inside groups.
   * set to true if you want to select an object inside a group.\
   * **REQUIRES** `subTargetCheck` set to true
   * @default
   * @type boolean
   */
  interactive: boolean = false

  /**
   * Used internally to optimize performance
   * Once an object is selected, instance is rendered without the selected object.
   * This way instance is cached only once for the entire interaction with the selected object.
   * @private
   */
  private _activeObjects: FabricObject[] = [];

  private _firstLayoutDone: boolean = false;

  /**
   * Constructor
   *
   * @param {FabricObject[]} [objects] instance objects
   * @param {object} [options] Options object
   * @param {boolean} [objectsRelativeToGroup] true if objects exist in group coordinate plane
   */
  constructor(objects: FabricObject[], options: object, objectsRelativeToGroup: boolean) {
    //  setting angle, skewX, skewY must occur after initial layout
    super();
    this.set({ ...options, angle: 0, skewX: 0, skewY: 0 });
    this._objects = objects || [];
    this.__objectMonitor = this.__objectMonitor.bind(this);
    this.__objectSelectionTracker = this.__objectSelectionMonitor.bind(this, true);
    this.__objectSelectionDisposer = this.__objectSelectionMonitor.bind(this, false);
    this.forEachObject((object) => {
      this.enterGroup(object, false);
    });
    this._applyLayoutStrategy({
      type: 'initialization',
      options: options,
      objectsRelativeToGroup: objectsRelativeToGroup
    });
  }

  /**
   * @private
   * @param {string} key
   * @param {*} value
   */
  _set(key: string, value: any) {
    var prev = this[key];
    super._set(key, value);
    if (key === 'canvas' && prev !== value) {
      this.forEachObject((object) => {
        object._set(key, value);
      });
    }
    if (key === 'layout' && prev !== value) {
      this._applyLayoutStrategy({ type: 'layout_change', layout: value, prevLayout: prev });
    }
    if (key === 'interactive') {
      this.forEachObject(this._watchObject.bind(this, value));
    }
    return this;
  }

  /**
   * @private
   */
  protected _shouldSetNestedCoords() {
    return this.subTargetCheck;
  }

  /**
   * Override this method to enhance performance (for groups with a lot of objects).
   * If Overriding, be sure not pass illegal objects to group - it will break your app.
   * @private
   */
  protected _filterObjectsBeforeEnteringGroup(objects: FabricObject[]) {
    return objects.filter((object, index, array) => {
      // can enter AND is the first occurrence of the object in the passed args (to prevent adding duplicates)
      return this.canEnterGroup(object) && array.indexOf(object) === index;
    });
  }

  /**
   * Add objects
   * @param {...FabricObject} objects
   */
  add(...objects: FabricObject[]) {
    var allowedObjects = this._filterObjectsBeforeEnteringGroup(objects);
    super.add(allowedObjects, this._onObjectAdded);
    this._onAfterObjectsChange('added', allowedObjects);
  }

  /**
   * Inserts an object into collection at specified index
   * @param {FabricObject | FabricObject[]} objects Object to insert
   * @param {Number} index Index to insert object at
   */
  insertAt(objects: FabricObject | FabricObject[], index: number) {
    var allowedObjects = this._filterObjectsBeforeEnteringGroup(Array.isArray(objects) ? objects : [objects]);
    super.insertAt(allowedObjects, index, this._onObjectAdded);
    this._onAfterObjectsChange('added', allowedObjects);
  }

  /**
   * Remove objects
   * @param {...FabricObject} objects
   * @returns {FabricObject[]} removed objects
   */
  remove(...objects: FabricObject[]): FabricObject[] {
    var removed = super.remove(objects, this._onObjectRemoved);
    this._onAfterObjectsChange('removed', removed);
    return removed;
  }

  /**
   * Remove all objects
   * @returns {FabricObject[]} removed objects
   */
  removeAll(): FabricObject[] {
    this._activeObjects = [];
    return this.remove(...this._objects.slice());
  }

  /**
   * invalidates layout on object modified
   * @private
   */
  private __objectMonitor(opt) {
    this._applyLayoutStrategy(Object.assign({}, opt, {
      type: 'object_modified'
    }));
    this._set('dirty', true);
  }

  /**
   * keeps track of the selected objects
   * @private
   */
  private __objectSelectionMonitor(selected, opt) {
    var object = opt.target;
    if (selected) {
      this._activeObjects.push(object);
      this._set('dirty', true);
    }
    else if (this._activeObjects.length > 0) {
      var index = this._activeObjects.indexOf(object);
      if (index > -1) {
        this._activeObjects.splice(index, 1);
        this._set('dirty', true);
      }
    }
  }

  /**
   * @private
   * @param {boolean} watch
   * @param {FabricObject} object
   */
  protected _watchObject(watch: boolean, object: FabricObject) {
    var directive = watch ? 'on' : 'off';
    //  make sure we listen only once
    watch && this._watchObject(false, object);
    object[directive]('changed', this.__objectMonitor);
    object[directive]('modified', this.__objectMonitor);
    object[directive]('selected', this.__objectSelectionTracker);
    object[directive]('deselected', this.__objectSelectionDisposer);
  }

  /**
   * Checks if object can enter group and logs relevant warnings
   * @private
   * @param {FabricObject} object
   * @returns
   */
  protected canEnterGroup(object: FabricObject) {
    if (object === this || this.isDescendantOf(object)) {
      //  prevent circular object tree
      /* _DEV_MODE_START_ */
      console.error('Group: circular object trees are not supported, this call has no effect');
      /* _DEV_MODE_END_ */
      return false;
    }
    else if (this._objects.indexOf(object) !== -1) {
      // is already in the objects array
      /* _DEV_MODE_START_ */
      console.error('Group: duplicate objects are not supported inside group, this call has no effect');
      /* _DEV_MODE_END_ */
      return false;
    }
    return true;
  }

  /**
   * @private
   * @param {FabricObject} object
   * @param {boolean} [removeParentTransform] true if object is in canvas coordinate plane
   * @returns {boolean} true if object entered group
   */
  enterGroup(object: FabricObject, removeParentTransform: boolean): boolean {
    if (object.group) {
      object.group.remove(object);
    }
    this._enterGroup(object, removeParentTransform);
    return true;
  }

  /**
   * @private
   * @param {FabricObject} object
   * @param {boolean} [removeParentTransform] true if object is in canvas coordinate plane
   */
  protected _enterGroup(object: FabricObject, removeParentTransform: boolean) {
    if (removeParentTransform) {
      // can this be converted to utils (sendObjectToPlane)?
      applyTransformToObject(
        object,
        multiplyTransformMatrices(
          invertTransform(this.calcTransformMatrix()),
          object.calcTransformMatrix()
        )
      );
    }
    this._shouldSetNestedCoords() && object.setCoords();
    object._set('group', this);
    object._set('canvas', this.canvas);
    this.interactive && this._watchObject(true, object);
    var activeObject = this.canvas && this.canvas.getActiveObject && this.canvas.getActiveObject();
    // if we are adding the activeObject in a group
    if (activeObject && (activeObject === object || object.isDescendantOf(activeObject))) {
      this._activeObjects.push(object);
    }
  }

  /**
   * @private
   * @param {FabricObject} object
   * @param {boolean} [removeParentTransform] true if object should exit group without applying group's transform to it
   */
  exitGroup(object: FabricObject, removeParentTransform: boolean) {
    this._exitGroup(object, removeParentTransform);
    object._set('canvas', undefined);
  }

  /**
   * @private
   * @param {FabricObject} object
   * @param {boolean} [removeParentTransform] true if object should exit group without applying group's transform to it
   */
  protected _exitGroup(object: FabricObject, removeParentTransform: boolean) {
    object._set('group', undefined);
    if (!removeParentTransform) {
      applyTransformToObject(
        object,
        multiplyTransformMatrices(
          this.calcTransformMatrix(),
          object.calcTransformMatrix()
        )
      );
      object.setCoords();
    }
    this._watchObject(false, object);
    var index = this._activeObjects.length > 0 ? this._activeObjects.indexOf(object) : -1;
    if (index > -1) {
      this._activeObjects.splice(index, 1);
    }
  }

  /**
   * @private
   * @param {'added'|'removed'} type
   * @param {FabricObject[]} targets
   */
  protected _onAfterObjectsChange(type: 'added' | 'removed', targets: FabricObject[]) {
    this._applyLayoutStrategy({
      type: type,
      targets: targets
    });
    this._set('dirty', true);
  }

  /**
   * @private
   * @param {FabricObject} object
   */
  protected _onObjectAdded(object: FabricObject) {
    this.enterGroup(object, true);
    object.fire('added', { target: this });
  }

  /**
   * @private
   * @param {FabricObject} object
   */
  protected _onRelativeObjectAdded(object: FabricObject) {
    this.enterGroup(object, false);
    object.fire('added', { target: this });
  }

  /**
   * @private
   * @param {FabricObject} object
   * @param {boolean} [removeParentTransform] true if object should exit group without applying group's transform to it
   */
  protected _onObjectRemoved(object: FabricObject, removeParentTransform: boolean) {
    this.exitGroup(object, removeParentTransform);
    object.fire('removed', { target: this });
  }

  /**
   * Decide if the object should cache or not. Create its own cache level
   * needsItsOwnCache should be used when the object drawing method requires
   * a cache step. None of the fabric classes requires it.
   * Generally you do not cache objects in groups because the group is already cached.
   * @return {Boolean}
   */
  shouldCache(): boolean {
    if (super.shouldCache()) {
      for (var i = 0; i < this._objects.length; i++) {
        if (this._objects[i].willDrawShadow()) {
          this.ownCaching = false;
          return false;
        }
      }
      return true
    }
    return false;
  }

  /**
   * Check if this object or a child object will cast a shadow
   * @return {Boolean}
   */
  willDrawShadow(): boolean {
    if (super.willDrawShadow()) {
      return true;
    }
    for (var i = 0; i < this._objects.length; i++) {
      if (this._objects[i].willDrawShadow()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if instance or its group are caching, recursively up
   * @return {Boolean}
   */
  isOnACache(): boolean {
    return this.ownCaching || (!!this.group && this.group.isOnACache());
  }

  /**
   * Execute the drawing operation for an object on a specified context
   * @param {CanvasRenderingContext2D} ctx Context to render on
   */
  drawObject(ctx: CanvasRenderingContext2D) {
    this._renderBackground(ctx);
    for (var i = 0; i < this._objects.length; i++) {
      this._objects[i].render(ctx);
    }
    this._drawClipPath(ctx, this.clipPath);
  }

  /**
   * Check if cache is dirty
   */
  isCacheDirty(skipCanvas) {
    if (super.isCacheDirty(skipCanvas)) {
      return true;
    }
    if (!this.statefullCache) {
      return false;
    }
    for (var i = 0; i < this._objects.length; i++) {
      if (this._objects[i].isCacheDirty(true)) {
        if (this._cacheCanvas) {
          // if this group has not a cache canvas there is nothing to clean
          var x = this.cacheWidth / this.zoomX, y = this.cacheHeight / this.zoomY;
          this._cacheContext.clearRect(-x / 2, -y / 2, x, y);
        }
        return true;
      }
    }
    return false;
  }

  /**
   * @override
   */
  setCoords() {
    super.setCoords();
    this._shouldSetNestedCoords() && this.forEachObject((object) => {
      object.setCoords();
    });
  }

  /**
   * Renders instance on a given context
   * @param {CanvasRenderingContext2D} ctx context to render instance on
   */
  render(ctx: CanvasRenderingContext2D) {
    //  used to inform objects not to double opacity
    this._transformDone = true;
    super.render(ctx);
    this._transformDone = false;
  }

  /**
   * @public
   * @param {Partial<LayoutResult> & { layout?: string }} [context] pass values to use for layout calculations
   */
  triggerLayout(context: Partial<LayoutResult> & { layout?: string; }) {
    if (context && context.layout) {
      context.prevLayout = this.layout;
      this.layout = context.layout;
    }
    this._applyLayoutStrategy({ type: 'imperative', context: context });
  }

  /**
   * @private
   * @param {FabricObject} object
   * @param {Point} diff
   */
  private _adjustObjectPosition(object: FabricObject, diff: Point) {
    object.set({
      left: object.left + diff.x,
      top: object.top + diff.y,
    });
  }

  /**
   * initial layout logic:
   * calculate bbox of objects (if necessary) and translate it according to options received from the constructor (left, top, width, height)
   * so it is placed in the center of the bbox received from the constructor
   *
   * @private
   * @param {LayoutContext} context
   */
  protected _applyLayoutStrategy(context: LayoutContext) {
    var isFirstLayout = context.type === 'initialization';
    if (!isFirstLayout && !this._firstLayoutDone) {
      //  reject layout requests before initialization layout
      return;
    }
    var options = isFirstLayout && context.options;
    var initialTransform = options && {
      angle: options.angle || 0,
      skewX: options.skewX || 0,
      skewY: options.skewY || 0,
    };
    var center = this.getRelativeCenterPoint();
    var result = this.getLayoutStrategyResult(this.layout, this._objects.concat(), context);
    if (result) {
      //  handle positioning
      var newCenter = new Point(result.centerX, result.centerY);
      var vector = center.subtract(newCenter).add(new Point(result.correctionX || 0, result.correctionY || 0));
      var diff = transformPoint(vector, invertTransform(this.calcOwnMatrix()), true);
      //  set dimensions
      this.set({ width: result.width, height: result.height });
      //  adjust objects to account for new center
      !context.objectsRelativeToGroup && this.forEachObject((object) => {
        this._adjustObjectPosition(object, diff);
      });
      //  clip path as well
      !isFirstLayout && this.layout !== 'clip-path' && this.clipPath && !this.clipPath.absolutePositioned
        && this._adjustObjectPosition(this.clipPath, diff);
      if (!newCenter.eq(center) || initialTransform) {
        //  set position
        this.setPositionByOrigin(newCenter, 'center', 'center');
        initialTransform && this.set(initialTransform);
        this.setCoords();
      }
    }
    else if (isFirstLayout) {
      //  fill `result` with initial values for the layout hook
      result = {
        centerX: center.x,
        centerY: center.y,
        width: this.width,
        height: this.height,
      };
      initialTransform && this.set(initialTransform);
    }
    else {
      //  no `result` so we return
      return;
    }
    //  flag for next layouts
    this._firstLayoutDone = true;
    //  fire layout hook and event (event will fire only for layouts after initialization layout)
    this.onLayout(context, result);
    this.fire('layout', {
      context: context,
      result: result,
      diff: diff
    });
    //  recursive up
    if (this.group && this.group._applyLayoutStrategy) {
      //  append the path recursion to context
      if (!context.path) {
        context.path = [];
      }
      context.path.push(this);
      //  all parents should invalidate their layout
      this.group._applyLayoutStrategy(context);
    }
  }


  /**
   * Override this method to customize layout.
   * If you need to run logic once layout completes use `onLayout`
   * @public
   *
   * @typedef {'initialization'|'object_modified'|'added'|'removed'|'layout_change'|'imperative'} LayoutContextType
   *
   * @typedef LayoutContext context object with data regarding what triggered the call
   * @property {LayoutContextType} type
   * @property {FabricObject[]} [path] array of objects starting from the object that triggered the call to the current one
   *
   * @typedef LayoutResult positioning and layout data **relative** to instance's parent
   * @property {number} centerX new centerX as measured by the containing plane (same as `left` with `originX` set to `center`)
   * @property {number} centerY new centerY as measured by the containing plane (same as `top` with `originY` set to `center`)
   * @property {number} [correctionX] correctionX to translate objects by, measured as `centerX`
   * @property {number} [correctionY] correctionY to translate objects by, measured as `centerY`
   * @property {number} width
   * @property {number} height
   *
   * @param {string} layoutDirective
   * @param {FabricObject[]} objects
   * @param {LayoutContext} context
   * @returns {LayoutResult | undefined}
   */
  getLayoutStrategyResult(layoutDirective: string, objects: FabricObject[], context: LayoutContext): LayoutResult | undefined {  // eslint-disable-line no-unused-vars
    //  `fit-content-lazy` performance enhancement
    //  skip if instance had no objects before the `added` event because it may have kept layout after removing all previous objects
    if (layoutDirective === 'fit-content-lazy'
      && context.type === 'added' && objects.length > context.targets.length) {
      //  calculate added objects' bbox with existing bbox
      var addedObjects = context.targets.concat(this);
      return this.prepareBoundingBox(layoutDirective, addedObjects, context);
    }
    else if (layoutDirective === 'fit-content' || layoutDirective === 'fit-content-lazy'
      || (layoutDirective === 'fixed' && (context.type === 'initialization' || context.type === 'imperative'))) {
      return this.prepareBoundingBox(layoutDirective, objects, context);
    }
    else if (layoutDirective === 'clip-path' && this.clipPath) {
      var clipPath = this.clipPath;
      var clipPathSizeAfter = clipPath._getTransformedDimensions();
      if (clipPath.absolutePositioned && (context.type === 'initialization' || context.type === 'layout_change')) {
        //  we want the center point to exist in group's containing plane
        var clipPathCenter = clipPath.getCenterPoint();
        if (this.group) {
          //  send point from canvas plane to group's containing plane
          var inv = invertTransform(this.group.calcTransformMatrix());
          clipPathCenter = transformPoint(clipPathCenter, inv);
        }
        return {
          centerX: clipPathCenter.x,
          centerY: clipPathCenter.y,
          width: clipPathSizeAfter.x,
          height: clipPathSizeAfter.y,
        };
      }
      else if (!clipPath.absolutePositioned) {
        var center;
        var clipPathRelativeCenter = clipPath.getRelativeCenterPoint(),
          //  we want the center point to exist in group's containing plane, so we send it upwards
          clipPathCenter = transformPoint(clipPathRelativeCenter, this.calcOwnMatrix(), true);
        if (context.type === 'initialization' || context.type === 'layout_change') {
          var bbox = this.prepareBoundingBox(layoutDirective, objects, context) || {};
          center = new Point(bbox.centerX || 0, bbox.centerY || 0);
          return {
            centerX: center.x + clipPathCenter.x,
            centerY: center.y + clipPathCenter.y,
            correctionX: bbox.correctionX - clipPathCenter.x,
            correctionY: bbox.correctionY - clipPathCenter.y,
            width: clipPath.width,
            height: clipPath.height,
          };
        }
        else {
          center = this.getRelativeCenterPoint();
          return {
            centerX: center.x + clipPathCenter.x,
            centerY: center.y + clipPathCenter.y,
            width: clipPathSizeAfter.x,
            height: clipPathSizeAfter.y,
          };
        }
      }
    }
    else if (layoutDirective === 'svg' && context.type === 'initialization') {
      var bbox = this.getObjectsBoundingBox(objects, true) || {};
      return Object.assign(bbox, {
        correctionX: -bbox.offsetX || 0,
        correctionY: -bbox.offsetY || 0,
      });
    }
  }

  /**
   * Override this method to customize layout.
   * A wrapper around {@link Group#getObjectsBoundingBox}
   * @public
   * @param {string} layoutDirective
   * @param {FabricObject[]} objects
   * @param {LayoutContext} context
   * @returns {LayoutResult | undefined}
   */
  prepareBoundingBox(layoutDirective: string, objects: FabricObject[], context: LayoutContext): LayoutResult | undefined {
    if (context.type === 'initialization') {
      return this.prepareInitialBoundingBox(layoutDirective, objects, context);
    }
    else if (context.type === 'imperative' && context.context) {
      return Object.assign(
        this.getObjectsBoundingBox(objects) || {},
        context.context
      );
    }
    else {
      return this.getObjectsBoundingBox(objects);
    }
  }

  /**
   * Calculates center taking into account originX, originY while not being sure that width/height are initialized
   * @public
   * @param {string} layoutDirective
   * @param {FabricObject[]} objects
   * @param {LayoutContext} context
   * @returns {LayoutResult | undefined}
   */
  protected prepareInitialBoundingBox(layoutDirective: string, objects: FabricObject[], context: LayoutContext): LayoutResult | undefined {
    var options = context.options || {},
      hasX = typeof options.left === 'number',
      hasY = typeof options.top === 'number',
      hasWidth = typeof options.width === 'number',
      hasHeight = typeof options.height === 'number';

    //  performance enhancement
    //  skip layout calculation if bbox is defined
    if ((hasX && hasY && hasWidth && hasHeight && context.objectsRelativeToGroup) || objects.length === 0) {
      //  return nothing to skip layout
      return;
    }

    var bbox = this.getObjectsBoundingBox(objects) || {};
    var width = hasWidth ? this.width : (bbox.width || 0),
      height = hasHeight ? this.height : (bbox.height || 0),
      calculatedCenter = new Point(bbox.centerX || 0, bbox.centerY || 0),
      origin = new Point(this.resolveOriginX(this.originX), this.resolveOriginY(this.originY)),
      size = new Point(width, height),
      strokeWidthVector = this._getTransformedDimensions({ width: 0, height: 0 }),
      sizeAfter = this._getTransformedDimensions({
        width: width,
        height: height,
        strokeWidth: 0
      }),
      bboxSizeAfter = this._getTransformedDimensions({
        width: bbox.width,
        height: bbox.height,
        strokeWidth: 0
      }),
      rotationCorrection = new Point(0, 0);

    //  calculate center and correction
    var originT = origin.scalarAdd(0.5);
    var originCorrection = sizeAfter.multiply(originT);
    var centerCorrection = new Point(
      hasWidth ? bboxSizeAfter.x / 2 : originCorrection.x,
      hasHeight ? bboxSizeAfter.y / 2 : originCorrection.y
    );
    var center = new Point(
      hasX ? this.left - (sizeAfter.x + strokeWidthVector.x) * origin.x : calculatedCenter.x - centerCorrection.x,
      hasY ? this.top - (sizeAfter.y + strokeWidthVector.y) * origin.y : calculatedCenter.y - centerCorrection.y
    );
    var offsetCorrection = new Point(
      hasX ?
        center.x - calculatedCenter.x + bboxSizeAfter.x * (hasWidth ? 0.5 : 0) :
        -(hasWidth ? (sizeAfter.x - strokeWidthVector.x) * 0.5 : sizeAfter.x * originT.x),
      hasY ?
        center.y - calculatedCenter.y + bboxSizeAfter.y * (hasHeight ? 0.5 : 0) :
        -(hasHeight ? (sizeAfter.y - strokeWidthVector.y) * 0.5 : sizeAfter.y * originT.y)
    ).add(rotationCorrection);
    var correction = new Point(
      hasWidth ? -sizeAfter.x / 2 : 0,
      hasHeight ? -sizeAfter.y / 2 : 0
    ).add(offsetCorrection);

    return {
      centerX: center.x,
      centerY: center.y,
      correctionX: correction.x,
      correctionY: correction.y,
      width: size.x,
      height: size.y,
    };
  }

  /**
   * Calculate the bbox of objects relative to instance's containing plane
   * @public
   * @param {FabricObject[]} objects
   * @returns {LayoutResult | null} bounding box
   */
  getObjectsBoundingBox(objects: FabricObject[], ignoreOffset?: boolean): LayoutResult | null {
    if (objects.length === 0) {
      return null;
    }
    var objCenter, sizeVector, min, max, a, b;
    objects.forEach(function (object, i) {
      objCenter = object.getRelativeCenterPoint();
      sizeVector = object._getTransformedDimensions().scalarDivideEquals(2);
      if (object.angle) {
        var rad = degreesToRadians(object.angle),
          sinValue = Math.abs(sin(rad)),
          cosValue = Math.abs(cos(rad)),
          rx = sizeVector.x * cosValue + sizeVector.y * sinValue,
          ry = sizeVector.x * sinValue + sizeVector.y * cosValue;
        sizeVector = new Point(rx, ry);
      }
      a = objCenter.subtract(sizeVector);
      b = objCenter.add(sizeVector);
      if (i === 0) {
        min = new Point(Math.min(a.x, b.x), Math.min(a.y, b.y));
        max = new Point(Math.max(a.x, b.x), Math.max(a.y, b.y));
      }
      else {
        min.setXY(Math.min(min.x, a.x, b.x), Math.min(min.y, a.y, b.y));
        max.setXY(Math.max(max.x, a.x, b.x), Math.max(max.y, a.y, b.y));
      }
    });

    var size = max.subtract(min),
      relativeCenter = ignoreOffset ? size.scalarDivide(2) : min.midPointFrom(max),
      //  we send `relativeCenter` up to group's containing plane
      offset = transformPoint(min, this.calcOwnMatrix()),
      center = transformPoint(relativeCenter, this.calcOwnMatrix());

    return {
      offsetX: offset.x,
      offsetY: offset.y,
      centerX: center.x,
      centerY: center.y,
      width: size.x,
      height: size.y,
    };
  }

  /**
   * Hook that is called once layout has completed.
   * Provided for layout customization, override if necessary.
   * Complements `getLayoutStrategyResult`, which is called at the beginning of layout.
   * @public
   * @param {LayoutContext} context layout context
   * @param {LayoutResult} result layout result
   */
  onLayout(/* context, result */) {
    //  override by subclass
  }

  /**
   *
   * @private
   * @param {'toObject'|'toDatalessObject'} [method]
   * @param {string[]} [propertiesToInclude] Any properties that you might want to additionally include in the output
   * @returns {object[]} serialized objects
   */
  private __serializeObjects(method: 'toObject' | 'toDatalessObject', propertiesToInclude: string[]) {
    var _includeDefaultValues = this.includeDefaultValues;
    return this._objects
      .filter(function (obj) {
        return !obj.excludeFromExport;
      })
      .map(function (obj) {
        var originalDefaults = obj.includeDefaultValues;
        obj.includeDefaultValues = _includeDefaultValues;
        var data = obj[method || 'toObject'](propertiesToInclude);
        obj.includeDefaultValues = originalDefaults;
        //delete data.version;
        return data;
      });
  }

  /**
   * Returns object representation of an instance
   * @param {string[]} [propertiesToInclude] Any properties that you might want to additionally include in the output
   * @return {Object} object representation of an instance
   */
  toObject(propertiesToInclude: string[]): object {
    var obj = super.toObject(['layout', 'subTargetCheck', 'interactive'].concat(propertiesToInclude));
    obj.objects = this.__serializeObjects('toObject', propertiesToInclude);
    return obj;
  }

  toString() {
    return '#<fabric.Group: (' + this.complexity() + ')>';
  }

  dispose() {
    this._activeObjects = [];
    this.forEachObject((object) => {
      this._watchObject(false, object);
      object.dispose && object.dispose();
    });
    super.dispose();
  }

  /* _TO_SVG_START_ */

  /**
   * @private
   */
  private _createSVGBgRect(reviver) {
    if (!this.backgroundColor) {
      return '';
    }
    var fillStroke = Rect.prototype._toSVG.call(this, reviver);
    var commons = fillStroke.indexOf('COMMON_PARTS');
    fillStroke[commons] = 'for="group" ';
    return fillStroke.join('');
  }

  /**
   * Returns svg representation of an instance
   * @param {Function} [reviver] Method for further parsing of svg representation.
   * @return {String[]} svg representation of an instance
   */
  _toSVG(reviver: Function): string[] {
    var svgString = ['<g ', 'COMMON_PARTS', ' >\n'];
    var bg = this._createSVGBgRect(reviver);
    bg && svgString.push('\t\t', bg);
    for (var i = 0; i < this._objects.length; i++) {
      svgString.push('\t\t', this._objects[i].toSVG(reviver));
    }
    svgString.push('</g>\n');
    return svgString;
  }

  /**
   * Returns styles-string for svg-export, specific version for group
   * @return {String}
   */
  getSvgStyles(): string {
    var opacity = typeof this.opacity !== 'undefined' && this.opacity !== 1 ?
      'opacity: ' + this.opacity + ';' : '',
      visibility = this.visible ? '' : ' visibility: hidden;';
    return [
      opacity,
      this.getSvgFilter(),
      visibility
    ].join('');
  }

  /**
   * Returns svg clipPath representation of an instance
   * @param {Function} [reviver] Method for further parsing of svg representation.
   * @return {String} svg representation of an instance
   */
  toClipPathSVG(reviver: Function): string {
    var svgString = [];
    var bg = this._createSVGBgRect(reviver);
    bg && svgString.push('\t', bg);
    for (var i = 0; i < this._objects.length; i++) {
      svgString.push('\t', this._objects[i].toClipPathSVG(reviver));
    }
    return this._createBaseClipPathSVGMarkup(svgString, { reviver: reviver });
  }
  /* _TO_SVG_END_ */

  /**
   * @todo support loading from svg
   * @private
   * @static
   * @memberOf Group
   * @param {object} object Object to create a group from
   * @returns {Promise<Group>}
   */
  static async fromObject({ objects: serializedObjects, ...serializedOptions }): Promise<Group> {
    const [objects, options] = await Promise.all([
      enlivenObjects(serializedObjects || []),
      enlivenObjectEnlivables(serializedOptions)
    ]);
    return new Group(objects, { ...serializedOptions, ...options }, true);
  }
}
