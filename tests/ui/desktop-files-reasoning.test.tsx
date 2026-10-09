import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {reasoningText,appendReasoningDelta} from '../../src/ui/reasoning';
import {resolveRemotePath} from '../../src/ui/remote-path';
import {MarkdownMessage} from '../../src/ui/conversation';
it('推理摘要分段并渲染粗体，不展示Markdown标记',()=>{
 const item:any={};appendReasoningDelta(item,'item/reasoning/summaryTextDelta',{summaryIndex:0,delta:'**Editing the documentation note**'});appendReasoningDelta(item,'item/reasoning/summaryTextDelta',{summaryIndex:1,delta:'**Reviewing the staged changes**'});
 const html=renderToStaticMarkup(<MarkdownMessage text={reasoningText(item)}/>);expect(html).toContain('<strong>Editing the documentation note</strong>');expect(html).toContain('<strong>Reviewing the staged changes</strong>');expect(html).not.toContain('**');
 expect(reasoningText({text:'**Editing****Reviewing**'})).toBe('**Editing**\n\n**Reviewing**');
});
it('图片相对路径按所在会话目录解析',()=>{
 expect(resolveRemotePath('docs/assets/settings.png','/workspace/project')).toBe('/workspace/project/docs/assets/settings.png');
 expect(resolveRemotePath('settings.png','/remote/project')).toBe('/remote/project/settings.png');
 expect(()=>resolveRemotePath('settings.png',null)).toThrow();
});
