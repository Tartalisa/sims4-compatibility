const COMPONENTS = {}

const registerComponent = (templateName, component) => {
    COMPONENTS[templateName.toUpperCase()] = component
}

String.prototype.hashCode = function () {
    var hash = 0, i, chr;
    if (this.length === 0) return hash;
    for (i = 0; i < this.length; i++) {
        chr = this.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

const RenderState = Object.freeze({
    READY: Symbol('READY'),
    SUSPEND: Symbol('SUSPEND'),
    PROCESSING: Symbol('PROCESSING'),
})

const _validator = (parent) => {
    return {
        get(target, key, receiver) {
            let value = target[key]
            if (typeof value === 'object' && value !== null) {
                return new Proxy(value, _validator(parent))
            }
            value = Reflect.get(...arguments);
            if (['add', 'delete', 'clear', 'push', 'pop', 'shift', 'unshift', 'splice', 'reverse',
                'sort'].includes(key)) parent.triggerRender()
            return typeof value == 'function' ? value.bind(target) : value
        },
        set(target, key, value) {
            if (target[key] === value) return true
            target[key] = value
            parent.triggerRender()
            return true
        }
    }
}

class Component {
    constructor(config, name = 'main') {
        this.name = name.toUpperCase()
        this.timeoutID = 0
        this.data_r = config.data
        this.data = new Proxy(config.data, _validator(this))
        this.actions = config.actions ?? {}
        this.events = config.events ?? {}
        this.conditionOk = true
        this.loop = {}
        this.template = config.template ?? document.querySelector(`script#${this.name.toLowerCase()}-template`).textContent.trim()
        this.root = config.root
        this.tmp_root = null
        this.children = {}
        this.usedInLastRender = new Set()
        this._renderState = RenderState.READY
    }

    triggerRender() {
        if (this.timeoutID) {
            clearTimeout(this.timeoutID)
        }
        this.timeoutID = setTimeout(() => this.render(), 10)
    }

    suspendRender() {
        this._renderState = RenderState.SUSPEND
    }

    releaseRender() {
        this._renderState = RenderState.READY
    }

    render() {
        if (RenderState.READY !== this._renderState) return
        this._renderState = RenderState.PROCESSING
        try {
            const virtualElement = document.createElement('div')
            virtualElement.innerHTML = this.template
            this._traverse(this.data, virtualElement.firstChild, '0')
            this.mergeChildren(this.root, virtualElement)
            for (let key of (new Set(Object.keys(this.children))).difference(this.usedInLastRender)) {
                delete this.children[key]
            }
        } finally {
            this.usedInLastRender.forEach(v => {
                this.children[v].root = this.children[v].tmp_root
            })
            this.usedInLastRender.clear()
            this.releaseRender()
            this.timeoutID = 0
        }
    }

    mergeChildren(root, virtualElement) {
        let children = Array.from(virtualElement.childNodes)
        for (let j in children) {
            this.mergeElements(root, root.childNodes[j], children[j])
        }
        while (root.childNodes.length > children.length) {
            root.removeChild(root.lastChild)
        }
    }

    mergeElements(root, realElement, virtualElement) {
        if (realElement instanceof Text && virtualElement instanceof Text) {
            realElement.textContent = virtualElement.textContent
            return
        }
        if (realElement instanceof Text && virtualElement instanceof HTMLElement
            || realElement instanceof HTMLElement && virtualElement instanceof Text) {
            root.insertBefore(virtualElement, realElement)
            root.removeChild(realElement)
            return
        }
        if (typeof realElement === 'undefined') {
            root.appendChild(virtualElement)
        } else if (realElement.tagName !== virtualElement.tagName) {
            root.replaceChild(virtualElement, realElement)
        } else {
            realElement.value = virtualElement.value
            let events = virtualElement.getAttribute('data-event') || ''
            events.split('|').forEach(event => {
                if (!event) return
                realElement[event] = virtualElement[event]
            })
            virtualElement.removeAttribute('data-event')
            Array.from(realElement.attributes).forEach(
                v => {
                    if (!virtualElement.hasAttribute(v.name)) {
                        realElement.removeAttribute(v.name)
                    } else {
                        realElement.setAttribute(v.name, virtualElement.getAttribute(v.name))
                        virtualElement.removeAttribute(v.name)
                    }
                }
            )
            Array.from(virtualElement.attributes).forEach(
                v => {
                    realElement.setAttribute(v.name, virtualElement.getAttribute(v.name))
                }
            )

            this.mergeChildren(realElement, virtualElement)
        }
    }

    _traverse(self, element, number) {
        if (element instanceof HTMLElement) {
            this._traverseHTMLElement(self, element, number)
        } else if (element instanceof Text) {
            this._traverseText(self, element)
        }
    }

    _getChildComponentRootNode(element, number, self, actions, loop) {
        let cmp, originalNumber = number, adder = 0, extraData = {}, events = {}
        for (let attr of Array.from(element.attributes)) {
            if (attr.name.startsWith(':')) {
                extraData[attr.name.slice(1)] = Object.values(this._parseData(self, attr.value))[0]
            }
            if (attr.name.startsWith('@on:')) {
                let f = Object.values(this._parseData(self, attr.value))[0]
                events[attr.name.slice(4)] = (...args) => f.apply(this.data, args)
            }
        }
        while (this.usedInLastRender.has(number)) {
            adder++
            number = `${originalNumber}/${adder}`
        }
        if (this.children.hasOwnProperty(number)) {
            cmp = this.children[number]
            cmp.suspendRender()
            cmp.tmp_root = cmp.root
            cmp.root = document.createElement('div')
            Object.assign(cmp.data, extraData)
            cmp.events = events
            cmp.releaseRender()
        } else {
            let config = COMPONENTS[element.tagName]()
            Object.assign(config.data, extraData)
            config.events = events
            config.root = document.createElement('div')
            cmp = new Component(config, element.tagName)
            cmp.tmp_root = cmp.root
            this.children[number] = cmp
        }
        cmp.render()
        this.usedInLastRender.add(number)
        return cmp.root
    }

    _traverseHTMLElement(self, element, number) {
        let actions = this.actions
        let loop = this.loop
        let events = this.events
        let processChildren = true
        if (COMPONENTS.hasOwnProperty(element.tagName)) {
            const hash = JSON.stringify(loop.item || '').hashCode()
            let newElement = this._getChildComponentRootNode(element, `${number}:${hash}`, this.data_r, actions, loop)
            Array.from(element.attributes).forEach(attr => {
                if (!':@'.includes(attr.name[0])) newElement.setAttribute(attr.name, attr.value)
            })
            element.parentNode.replaceChild(newElement, element)
            return
        }
        for (let attr of Array.from(element.attributes)) {
            if (attr.name === '@if') {
                this.conditionOk = eval(attr.value)
                if (!this.conditionOk) {
                    element.parentNode.replaceChild(new Text(' '), element)
                    processChildren = false
                }
                element.removeAttribute(attr.name)
            } else if (attr.name === '@elif') {
                let result = !this.conditionOk && eval(attr.value)
                this.conditionOk |= result
                if (!result) {
                    element.parentNode.replaceChild(new Text(' '), element)
                    processChildren = false
                }
                element.removeAttribute(attr.name)
            } else if (attr.name === '@else') {
                let result = !this.conditionOk
                this.conditionOk |= result
                if (!result) {
                    element.parentNode.replaceChild(new Text(' '), element)
                    processChildren = false
                }
                element.removeAttribute(attr.name)
            } else if (attr.name === '@for') {
                let v = eval(attr.value)
                const e = element.firstElementChild
                let insertMethod
                if (element.hasAttribute('@hold')) {
                    element.removeChild(e)
                    element.removeAttribute('@hold')
                    insertMethod = (e) => element.appendChild(e)
                } else {
                    let parent = element.parentNode
                    if (element.nextSibling) {
                        let sibl = element.nextSibling
                        insertMethod = (e) => parent.insertBefore(e, sibl)
                    }
                    else {
                        insertMethod = (e) => parent.appendChild(e)
                    }
                    parent.removeChild(element)
                    element = parent
                }
                this.loop = {
                    item: 0,
                    index: 0,
                    parent: loop
                }
                for (let i in v) {
                    this.loop.item = v[i]
                    this.loop.index = i
                    let el = e.cloneNode(true)
                    this._traverse(self, el, number)
                    insertMethod(el)
                }
                this.loop = this.loop.parent
                processChildren = false
                element.removeAttribute(attr.name)
            } else if (attr.name.startsWith('@on:')) {
                let name = attr.name.slice(4)
                let value = attr.value
                let eventName = `on${name}`
                element[eventName] = (() => {
                    let loop = Object.assign({}, this.loop)
                    return (event) => {
                        this.callAction(value, self, actions, loop, event, events)
                    }
                }).call(this)
                let curr = element.getAttribute('data-event')
                if (curr) {
                    eventName += `|${curr}`
                }
                element.setAttribute('data-event', eventName)
                element.removeAttribute(attr.name)
            } else if (attr.name.startsWith(':')) {
                let res = this._parseText(self, attr.value)
                if (res !== 'false')
                    element.setAttribute(attr.name.slice(1), res)
                element.removeAttribute(attr.name)
            }
        }
        if (!processChildren) return
        let i = 0
        for (let e of Array.from(element.childNodes)) {
            this._traverse(self, e, `${number}:${i}`)
            i++
        }
    }

    callAction(value, self, actions, loop, event, events) {
        let [f, args] = this.parseAction(value, self, actions, loop, event, events)
        this.call(f, self, args)
    }

    parseAction(value, self, actions, loop, event, events) {
        let [_, func, params] = value.match(/^([A-z\.]+)\((.*)\)$/)
        params = params.split(',').filter(v => v !== '').map(v => eval(v))
        return [eval(func), params]
    }

    call(f, self, args) {
        args = args.map(v => {
            if (v instanceof Array) {
                return this.call(v[0], self, v.slice(1))
            }
            return v
        })
        f.call(self, ...args)
    }

    _traverseText(self, element) {
        element.textContent = this._parseText(self, element.textContent)
    }

    _parseData(self, text) {
        let loop = this.loop
        let actions = this.actions
        let events = this.events
        let res = {}
        for (let [_, t] of text.matchAll(/{{([^}]+)}}/g)) {
            let v = eval(t)
            res[t] = v
        }
        return res
    }

    _parseText(self, text) {
        for (let [t, v] of Object.entries(this._parseData(self, text))) {
            text = text.replace(`{{${t}}}`, v)
        }
        return text
    }
}
