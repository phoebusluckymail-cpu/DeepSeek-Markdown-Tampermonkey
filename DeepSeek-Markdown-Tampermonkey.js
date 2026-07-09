// ==UserScript==
// @name         DeepSeek 聊天记录导出 (Markdown 带目录)
// @namespace    http://tampermonkey.net/
// @version      5.11
// @description  打印预览强制渲染全部消息，纯Markdown目录，截断100字符
// @match        *://*.deepseek.com/*
// @grant        GM_download
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // ---------- 工具函数 ----------
    function getPlainText(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent.trim();
    }

    function truncate(text, maxLen) {
        if (text.length <= maxLen) return text;
        return text.slice(0, maxLen) + '…';
    }

    function removeNewlines(text) {
        return text.replace(/[\r\n]+/g, ' ');
    }

    // ---------- 核心转换函数（仅用于助手消息） ----------
    function htmlToMarkdown(html) {
        const div = document.createElement('div');
        div.innerHTML = html;

        function processNode(node) {
            if (node.nodeType === Node.TEXT_NODE) return node.textContent;
            if (node.nodeType !== Node.ELEMENT_NODE) return '';

            const tag = node.tagName.toLowerCase();

            if (node.classList && node.classList.contains('md-code-block-banner')) {
                return '';
            }

            if (tag === 'pre') {
                let language = '';
                let parent = node.parentElement;
                while (parent && parent !== document.body) {
                    const langSpan = parent.querySelector('.d813de27');
                    if (langSpan) {
                        language = langSpan.textContent.trim();
                        break;
                    }
                    const codeEl = parent.querySelector('code');
                    if (codeEl) {
                        const langMatch = codeEl.className.match(/language-(\w+)/);
                        if (langMatch) {
                            language = langMatch[1];
                            break;
                        }
                    }
                    parent = parent.parentElement;
                }

                const clone = node.cloneNode(true);
                clone.querySelectorAll('[role="button"], .ds-button').forEach(btn => btn.remove());
                let codeText = clone.textContent.replace(/^\s+/, '').replace(/\s+$/, '');
                return '```' + language + '\n' + codeText + '\n```\n\n';
            }

            const children = Array.from(node.childNodes).map(processNode).join('');

            switch (tag) {
                case 'h1': return '# ' + children + '\n\n';
                case 'h2': return '## ' + children + '\n\n';
                case 'h3': return '### ' + children + '\n\n';
                case 'h4': return '#### ' + children + '\n\n';
                case 'h5': return '##### ' + children + '\n\n';
                case 'h6': return '###### ' + children + '\n\n';
                case 'p': return children + '\n\n';
                case 'strong': case 'b': return '**' + children + '**';
                case 'em': case 'i': return '*' + children + '*';
                case 'code': return '`' + children + '`';
                case 'ul': return children + '\n';
                case 'ol': return children + '\n';
                case 'li': return '- ' + children + '\n';
                case 'blockquote': return '> ' + children.replace(/\n/g, '\n> ') + '\n\n';
                case 'a': {
                    const href = node.getAttribute('href') || '#';
                    return '[' + children + '](' + href + ')';
                }
                case 'br': return '\n';
                case 'hr': return '---\n\n';
                case 'div': case 'span': return children;
                default: return children;
            }
        }

        let md = processNode(div);
        md = md.replace(/\n{3,}/g, '\n\n');
        return md.trim();
    }

    // ---------- 辅助判断函数 ----------
    function isThinkingElement(element) {
        if (element.querySelector('.ds-think-content')) return true;
        const cls = element.className;
        if (cls.includes('think') || cls.includes('reason')) return true;
        const span = element.querySelector('span');
        if (span) {
            const text = span.innerText.trim();
            if (/^已思考（用时 .* 秒）$/.test(text)) {
                const icons = element.querySelectorAll('.ds-icon');
                if (icons.length >= 2) return true;
            }
        }
        return false;
    }

    function isAssistant(element) {
        const cls = element.className;
        return cls.includes('assistant') || cls.includes('ds-assistant');
    }

    function isAIGeneratedHint(element) {
        const text = element.innerText.trim();
        return text === '本回答由 AI 生成，内容仅供参考，请仔细甄别';
    }

    // ---------- 提取消息 ----------
    function extractMessages() {
        const groups = document.querySelectorAll('.ds-message');
        if (!groups.length) return [];

        let allMessages = [];
        for (const group of groups) {
            const children = Array.from(group.children).filter(el =>
                el.tagName === 'DIV' && el.innerText.trim().length > 0
            );

            let userEl = null, assistantEl = null;

            for (const el of children) {
                if (isThinkingElement(el)) continue;
                if (isAIGeneratedHint(el)) continue;
                if (isAssistant(el)) {
                    assistantEl = el;
                    continue;
                }
                if (!userEl) userEl = el;
            }

            if (userEl) {
                const html = userEl.innerHTML;
                if (html.trim()) {
                    allMessages.push({ role: 'user', html: html });
                }
            }
            if (assistantEl) {
                const html = (assistantEl.querySelector('.ds-markdown, .markdown, .prose, .message-content') || assistantEl).innerHTML;
                if (html.trim()) {
                    allMessages.push({ role: 'assistant', html: html });
                }
            }
        }
        return allMessages;
    }

    // ---------- 核心：打印渲染 + 导出 ----------
    function doExport() {
        const allMessages = extractMessages();
        if (!allMessages.length) {
            alert('未提取到任何消息内容。');
            return;
        }

        console.log(`共提取到 ${allMessages.length} 条消息（用户 ${allMessages.filter(m => m.role === 'user').length}，DeepSeek ${allMessages.filter(m => m.role === 'assistant').length}）`);

        // ----- 构建纯 Markdown 目录（截断 100 字符） -----
        let tocItems = [];
        const userMessages = allMessages.filter(m => m.role === 'user');
        for (let i = 0; i < userMessages.length; i++) {
            const msg = userMessages[i];
            // 使用 textContent 解码，保证长度准确
            const plainText = getPlainText(msg.html);
            const cleanText = removeNewlines(plainText);
            // ★★★ 截断长度改为 100 ★★★
            let displayText = truncate(cleanText, 100);
            if (!displayText) displayText = '[消息]';
            const anchor = `msg-${i+1}`;
            tocItems.push(`${i+1}. [${displayText}](#${anchor})`);
        }

        let tocMarkdown = '';
        if (tocItems.length > 0) {
            tocMarkdown = '# 📑 目录\n\n' + tocItems.join('\n') + '\n\n___\n\n';
        }

        // ----- 生成正文（使用 <span id="msg-X"></span> 锚点） -----
        let bodyMarkdown = '';
        let userCounter = 0;
        for (const msg of allMessages) {
            if (msg.role === 'user') {
                userCounter++;
                bodyMarkdown += `<span id="msg-${userCounter}"></span>\n\n`;
                bodyMarkdown += `**👤 用户**\n\n${msg.html}\n\n___\n\n`;
            } else {
                const md = htmlToMarkdown(msg.html);
                if (md) {
                    bodyMarkdown += `**🤖 DeepSeek**\n\n${md}\n\n___\n\n`;
                }
            }
        }

        const fullMarkdown = tocMarkdown + bodyMarkdown;

        if (!fullMarkdown.trim()) {
            alert('转换后内容为空。');
            return;
        }

        // 下载
        const blob = new Blob([fullMarkdown], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `DeepSeek_Chat_${new Date().toISOString().slice(0,10)}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);

        console.log('✅ 导出完成！');
    }

    function exportWithPrint() {
        alert('将打开打印预览，关闭打印预览后自动导出 Markdown（含目录）。');

        function onAfterPrint() {
            window.removeEventListener('afterprint', onAfterPrint);
            console.log('打印预览已关闭，开始导出...');
            doExport();
        }
        window.addEventListener('afterprint', onAfterPrint);
        window.print();
    }

    // ---------- 添加按钮 ----------
    function addButton() {
        if (document.getElementById('deepseek-export-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'deepseek-export-btn';
        btn.textContent = '📄 导出 (打印渲染)';
        Object.assign(btn.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 9999,
            padding: '10px 16px',
            backgroundColor: '#17a2b8',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            transition: 'background-color 0.2s'
        });
        btn.addEventListener('mouseenter', () => btn.style.backgroundColor = '#138496');
        btn.addEventListener('mouseleave', () => btn.style.backgroundColor = '#17a2b8');
        btn.addEventListener('click', exportWithPrint);
        document.body.appendChild(btn);
        console.log('导出按钮已添加（Markdown目录）');
    }

    // ---------- 初始化 ----------
    window.addEventListener('load', () => setTimeout(addButton, 1500));

    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(addButton, 1500);
        }
    }, 3000);

    console.log('DeepSeek 导出脚本（v5.11）已加载，点击蓝色按钮即可。');
})();
