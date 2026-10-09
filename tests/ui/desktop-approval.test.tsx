import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {ApprovalSheet} from '../../src/features/approvals/ApprovalSheet';
it('桌面审批展示原始选项，并提交用户选择的精确选项',()=>{
 const choose=vi.fn();render(<ApprovalSheet approval={{id:'p',method:'item/commandExecution/requestApproval',params:{desktopApproval:{text:'执行这个操作？',options:[{id:'once',label:'仅允许本次'},{id:'no',label:'取消操作'}]}}}} userAnswers={{}} onAnswerChange={()=>{}} onSubmitAnswers={()=>{}} onDecision={()=>{}} onDesktopChoice={choose}/>);
 expect(screen.getByText('执行这个操作？')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'仅允许本次'}));expect(choose).toHaveBeenCalledWith('once');expect(screen.queryByRole('button',{name:'允许'})).toBeNull();
});
