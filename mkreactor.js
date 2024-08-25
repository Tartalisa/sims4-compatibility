const COMPONENTS = {}

const registerComponent = (templateName, component) => {
    COMPONENTS[templateName] = component
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
            target[key] = value
            parent.triggerRender()
            return true
        }
    }
}

class Component {
    constructor(config) {
        this.timeoutID = 0
        this.data = new Proxy(config.data, _validator(this))
        this.actions = config.actions ?? {}
        this.conditionOk = true
        this.loop = {}
        this.template = config.template
        this.root = config.root
        this.children = {}
        this.usedInLastRender = new Set()
        this.render()
    }

    triggerRender() {
        if (this.timeoutID) {
            return
        }
        this.timeoutID = setTimeout(() => this.render(), 25)
    }

    render() {
        this.usedInLastRender.clear()
        const virtualElement = document.createElement('div')
        virtualElement.innerHTML = this.template
        this._traverse(this.data, virtualElement.firstChild, '0')
        this.mergeChildren(this.root, virtualElement)
        let badChildrenComponents = (new Set(Object.keys(this.children))).difference(this.usedInLastRender)
        for (let key of badChildrenComponents) {
            delete this.children[key]
        }
        this.timeoutID = 0
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
        console.log(this.root, realElement, virtualElement)
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
        let cmp, originalNumber = number, adder = 0, extraData = {}
        for (let attr of Array.from(element.attributes)) {
            if (attr.name.startsWith(':')) {
                extraData[attr.name.slice(1)] = Object.values(this._parseData(self, attr.value))[0]
            }
        }
        while (this.usedInLastRender.has(number)) {
            adder++
            number = `${originalNumber}/${adder}`
        }
        if (this.children.hasOwnProperty(number)) {
            cmp = this.children[number]
            cmp.timeoutID = -1
            Object.assign(cmp.data, extraData)
            cmp.render()
        } else {
            let config = COMPONENTS[element.tagName]()
            Object.assign(config.data, extraData)
            config.root = document.createElement('div')
            cmp = new Component(config)
            this.children[number] = cmp
        }
        this.usedInLastRender.add(number)
        return cmp.root
    }

    _traverseHTMLElement(self, element, number) {
        let actions = this.actions
        let loop = this.loop
        let processChildren = true
        if (COMPONENTS.hasOwnProperty(element.tagName)) {
            const hash = JSON.stringify(loop.item || '').hashCode()
            let newElement = this._getChildComponentRootNode(element, `${number}:${hash}`, self, actions, loop)
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
                const e = element.firstChild
                if (element.hasAttribute('@hold')) {
                    element.removeChild(e)
                    element.removeAttribute('@hold')
                } else {
                    let parent = element.parentNode
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
                    element.appendChild(el)
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
                        this.magic(value, self, actions, loop, event)
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

    magic(value, self, actions, loop, event) {
        let [f, args] = this.parse(value, self, actions, loop, event)
        this.call(f, self, args)
    }

    parse(value, self, actions, loop, event) {
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
