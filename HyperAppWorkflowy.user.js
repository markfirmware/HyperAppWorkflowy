// ==UserScript==
// @name         HyperAppWorkflowy
// @namespace    http://tampermonkey.net/
// @version      0.6
// @description  HyperApp applied to WorkFlowy
// @author       Mark E Kendrat
// @match        https://workflowy.com/
// @match        https://beta.workflowy.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=workflowy.com
// @grant        none
// ==/UserScript==

(async () => {
    const starting_state = { log: [] }
    window.WFEventListener = (event) => {
        if (event == 'documentReady') {
            const style = document.createElement('style')
            style.appendChild(document.createTextNode('')) // for webkit
            document.head.appendChild(style)
            style.sheet.addRule('.contentTag', 'padding: 0px 1px !important')
            style.sheet.addRule('.children', 'padding-left: 23px !important')
            addStarredQueries(starting_state)
            recordAction(starting_state, "StartApp")
            startApp(starting_state)
        }
    }
    const { h, text, app } = await import("https://unpkg.com/hyperapp")
    const WF = window.WF
    const locationChanged = "locationChanged"
    const searchTyped = "searchTyped"
    const listenToMessageRemoved = (dispatch, action) => {
        const observer = new MutationObserver(function(mutations_list) {
            mutations_list.forEach(function(mutation) {
                mutation.removedNodes.forEach(function(removed_node) {
                    if(removed_node.className == ' _171q9nk') {
                        dispatch(action)
                    }
                })
            })
        })
        observer.observe(document.body, { subtree: true, childList: true })
        return () => observer.disconnect()
    }
    const onMessageRemoved = (action) => [listenToMessageRemoved, action]
    var stopApp
    const MessageRemoved = (s) => {
        console.log("message removed - restarting app")
        stopApp()
        startApp(s)
    }
    var nesting = 0
    const listenToWorkflowy = (dispatch, action) => {
        window.WFEventListener = (event) => {
            try {
                nesting += 1
                dispatch(action, event)
            } catch (e) {
                console.log(e)
            }
            nesting -= 1
        }
        return (function () { window.WFEventListener = null })
    }
    const onWorkflowyEvent = (action) => [listenToWorkflowy, action]
    const WfEventReceived = (s, event) => {
        try {
            const was_editing_id = isEditEvent(s.log?.[0].event) && focusedId(s.log)
            record(s, event, () => {
                if (isEditEvent(event)) {
                    const focused = WF.focusedItem()
                    return { commentFocusedName: focused != null ?
                            focused.getNameInPlainText() : "<not focused!>" }
                }
            })
            if (focusedId(s.log) != was_editing_id) {
                const was_editing_item = WF.getItemById(was_editing_id)
                if (was_editing_item) {
                    lostFocus(s, was_editing_item)
                } else {
                    console.log("editing " + was_editing_id + " not found")
                }
            }
        } catch (e) {
            console.log(e)
        }
        return { ...s }
    }
    const improved = (original) => {
        if (original == null) {
            return null
        }

        var modified = original

        // remove all spaces at end of line
        modified = modified.replace(/ +$/, '')

        // put 0 in front of single digit date
        modified = modified.replaceAll(/, (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d), /g, ', $1 0$2, ')

        // put space in front of single digit hour
        modified = modified.replaceAll(/ at (\d):(\d\d)(am|pm)/g, ' at  $1:$2$3')

        return modified
    }
    const lostFocus = (s, item) => {
        const original = item.getName()
        const better = improved(original)
        if (better != original) {
            WF.setItemName(item, better)
            recordReaction(s, "PostEditChange")
        }
    }
    const isEditEvent = (event) => event == "edit" || event == "operation--edit"
    const record = (s, event, moreFn) => {
        var r = {
            event: event,
        }
        if (nesting > 1) {
            r.nesting = nesting
        }
        const c = WF.currentItem().getId()
        if (c != currentId(s.log)) {
            r.currentId = c
        }
        const f = isEditEvent(event) && WF.focusedItem()?.getId() || ""
        if (f != focusedId(s.log)) {
            r.focusedId = f
        }
        const query_or_null = WF.currentSearchQuery()
        const q = query_or_null ? query_or_null.trim() : ""
        if (q != query(s.log)) {
            r.query = q
        }
        r = { ...r, ...moreFn?.() }
        s.log.unshift(r)
        return r
    }
    const recordAction = (s, actionName, moreFn) => {
        record(s, actionName, moreFn)
        return { ...s }
    }
    const recordReaction = (s, actionName, moreFn) => {
        record(s, actionName, moreFn)
        return { ...s }
    }
    const recordAsString = (r) => {
        var s = r?.nesting ? r.nesting.toString() + "/" : ""
        s += r.event
        s += (r.show_log !== undefined) ? " " + r.show_log : ""
        s += (r.query !== undefined) ? " " + r.query : ""
        s += (r.currentId !== undefined) ?
            (" current:" +
             (WF.getItemById(r.currentId) ?
              WF.getItemById(r.currentId).getUrl() : "(deleted? " + r.currentId + ")")) : ""
        s += (r.focusedId !== undefined) ?
            r.focusedId ?
            (" focused:" +
             (WF.getItemById(r.focusedId) ?
              WF.getItemById(r.focusedId).getUrl() : "(deleted? " + r.focusedId + ")")) : " lost-focus"
        : ""
        s += (r.commentFocusedName !== undefined) ? " <" + r.commentFocusedName + ">" : ""
        return s
    }
    const stableQueries = (log) => {
        const log2 = []
        var i = 0
        while (i < log.length) {
            if (i + 1 < log.length &&
                log[i + 0].event == searchTyped &&
                log[i + 1].event == locationChanged &&
                log[i + 1].query !== undefined) {
                log2.push(log[i + 1])
                var q = log[i + 1].query
                i += 2
                while (i + 1 < log.length &&
                       log[i + 0].event == searchTyped &&
                       log[i + 1].event == locationChanged &&
                       log[i + 1].query !== undefined &&
                       q.startsWith(log[i + 1].query)) {
                    q = log[i + 1].query
                    i += 2
                }
            } else {
                if (log[i + 0] !== undefined) {
                    log2.push(log[i + 0])
                }
                i += 1
            }
        }
        return log2
    }
    const getSearchHistory = (log) => {
        const h = []
        for (const r of stableQueries(log)) {
            if (r?.query && !h.includes(r.query)) {
                h.push(r.query)
            }
        }
        h.push("")
        return h
    }
    const addStarredQueries = (s) => {
        WF.starredLocations()
            .filter((x) => x.search != null)
            .map((x) => x.search)
            .sort()
            .reverse()
            .map((x) => record(s, "AddStarredQuery", () => ({ query: x })))
    }
    const mostRecent = (log, propertyName, def = '') => {
        for (const x of log) {
            const y = x[propertyName]
            if (y !== undefined) {
                return y
            }
        }
        return def
    }
    const focusedId = (log) => mostRecent(log, 'focusedId')
    const focusedItem = (log) => WF.getItemById(focusedId(log))
    const focusedName = (log) => {
        const item = focusedItem(log)
        return item == null ? null : item.getNameInPlainText()
    }
    const currentId = (log) => mostRecent(log, 'currentId')
    const query = (log) => mostRecent(log, 'query')
    const showLog = (log) => mostRecent(log, 'show_log', false)
    const ChangeSearch = (s, q) => {
        return recordAction(s, "ChangeSearch", () => {
            WF.search(q)
        })
    }
    const ResetLog = (s) => {
        s.log = []
        addStarredQueries(s)
        return recordAction(s, "ResetLog")
    }
    const ToggleShowLog = (s) => recordAction(s, "ToggleShowLog", () => ({ show_log: !showLog(s.log) }))
    const startApp = (initialState) => {
        const app_dom_id = "workflowy-showmessage-div"
        WF.hideMessage()
        WF.showMessage(`<div id="${app_dom_id}"></div>`)
        const font = { style: {"font-family": "monospace"} }
        stopApp = app({
            node: document.getElementById(app_dom_id),
            init: initialState,
            view: ({ log }) =>
            h("div", {
                style: {
                    "font-family": "monospace",
                    "background-color": "lightgreen",
                    "color": "black",
                    "text-align": "left",
                }, }, [
                h("button", { ...font, onclick: ToggleShowLog, title: "hide/show event log" },
                  text(log.length.toString().padStart(3, "0") + (log.length == 1 ? "  event" : " events"))),
                getSearchHistory(log).length > 1 && h("select", {
                    onchange: (_, e) => [ChangeSearch, e.target.value],
                    title: "search history including starred"
                }, getSearchHistory(log).map((q) => h("option", {selected: q == query(log), title: q}, text(q)))),
                improved(focusedName(log)) != focusedName(log) && h("span", {}, text("dates will be reformatted and/or trailing spaces removed")),
                h("div", { hidden: !showLog(log) || log.length == 0 }, [
                    h("button", { ...font, onclick: ResetLog, title: "reset event log" }, text("reset")),
                    h("div", { style: { "overflow-y": "auto" } },
                      h("ul", {}, log.slice(0, 10).map((m) => h("li", {}, text(recordAsString(m))))),
                     )]),
            ]),
            subscriptions: (s) => [onWorkflowyEvent(WfEventReceived), onMessageRemoved(MessageRemoved)],
        })
    }
    })()
