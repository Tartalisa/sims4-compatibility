const _validator = (parent) => {
    return {
        get(target, key, receiver) {
            let value = target[key]
            if (typeof value === 'object' && value !== null) {
                return new Proxy(value, _validator(parent))
            }
            value = Reflect.get(...arguments);
            if (['add', 'delete', 'clear', 'push', 'pop', 'unshift'].includes(key)) parent.triggerRender()
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
        this.template = config.template()
        this.root = config.root
        this.render(true)
    }

    triggerRender() {
        if (this.timeoutID) {
            return
        }
        this.timeoutID = setTimeout(() => this.render(), 25)
    }

    render(initial = false) {
        const virtualElement = document.createElement('div')
        virtualElement.innerHTML = this.template
        this._traverse(this.data, virtualElement.firstChild)
        if (initial) {
            this.root.replaceChildren(...virtualElement.childNodes)
        } else {
            this.mergeChildren(this.root, virtualElement)
        }
        this.timeoutID = 0
    }

    mergeChildren(root, virtualElement) {
        let children = Array.from(virtualElement.childNodes)
        for (let j in children) {
            let virtualNode = children[j]
            let rootNode = root.childNodes[j]
            if (typeof rootNode === 'undefined') {
                root.appendChild(virtualNode)
                continue
            }
            this.mergeElements(rootNode, virtualNode)
        }
        while (root.childNodes.length > children.length) {
            root.removeChild(root.lastChild)
        }
    }

    mergeElements(realElement, virtualElement) {
        if (realElement instanceof Text && virtualElement instanceof Text) {
            realElement.textContent = virtualElement.textContent
            return
        }
        if (realElement instanceof Text && virtualElement instanceof HTMLElement
            || realElement instanceof HTMLElement && virtualElement instanceof Text) {
            realElement.parentNode.insertBefore(virtualElement, realElement)
            realElement.parentNode.removeChild(realElement)
            return
        }
        if (realElement.tagName !== virtualElement.tagName) {
            realElement.parentNode.insertBefore(virtualElement, realElement)
            realElement.parentNode.removeChild(realElement)
        } else {
            realElement.value = virtualElement.value
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
            element.setAttribute('_id', number)
            this._traverseHTMLElement(self, element)
        } else if (element instanceof Text) {
            this._traverseText(self, element)
        }
    }

    _traverseHTMLElement(self, element) {
        let actions = this.actions
        let loop = this.loop
        let processChildren = true
        for (let attr of Array.from(element.attributes)) {
            if (attr.name === '@if') {
                this.conditionOk = eval(attr.value)
                element.removeAttribute(attr.name)
                if (!this.conditionOk) {
                    element.parentNode.insertBefore(new Text(' '), element)
                    element.parentNode.removeChild(element)
                    processChildren = false
                }
            } else if (attr.name === '@elif') {
                let result = !this.conditionOk && eval(attr.value)
                element.removeAttribute(attr.name)
                this.conditionOk |= result
                if (!result) {
                    element.parentNode.insertBefore(new Text(' '), element)
                    element.parentNode.removeChild(element)
                    processChildren = false
                }
            } else if (attr.name === '@else') {
                let result = !this.conditionOk
                element.removeAttribute(attr.name)
                this.conditionOk |= result
                if (!result) {
                    element.parentNode.insertBefore(new Text(' '), element)
                    element.parentNode.removeChild(element)
                    processChildren = false
                }
            } else if (attr.name === '@for') {
                let v = eval(attr.value)
                const e = element.firstChild
                element.removeAttribute(attr.name)
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
                    this._traverse(self, el, i)
                    element.appendChild(el)
                }
                this.loop = this.loop.parent
                processChildren = false
            } else if (attr.name.startsWith('@on:')) {
                let name = attr.name.slice(4)
                let value = attr.value
                element.addEventListener(name, (() => {
                    let loop = Object.assign({}, this.loop)
                    return (event) => {
                        this.magic(value, self, actions, loop, event)
                    }
                }).call(this))
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
            this._traverse(self, e, i++)
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

    _parseText(self, text) {
        let loop = this.loop
        let actions = this.actions
        for (let [_, t] of text.matchAll(/{{([^}]+)}}/g)) {
            let v = eval(t)
            text = text.replace(`{{${t}}}`, v)
        }
        return text
    }
}
