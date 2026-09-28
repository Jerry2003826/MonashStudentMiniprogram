from django import forms

ROLE_CHOICES = [("owner", "账号负责人"), ("reviewer", "会员审核员"), ("editor", "内容编辑员")]


class StaffCreateForm(forms.Form):
    user_id = forms.IntegerField(label="微信用户编号", min_value=1)
    role = forms.ChoiceField(label="角色", choices=ROLE_CHOICES)


class StaffEditForm(forms.Form):
    role = forms.ChoiceField(label="角色", choices=ROLE_CHOICES)
    is_active = forms.BooleanField(label="允许访问管理后台", required=False)


class ReviewForm(forms.Form):
    decision = forms.ChoiceField(choices=[("approved", "批准"), ("rejected", "拒绝")])
    note = forms.CharField(label="审核备注", max_length=1000, required=False)


class ForumReviewForm(forms.Form):
    decision = forms.ChoiceField(
        label="审核结果", choices=[("approved", "批准发布"), ("rejected", "拒绝发布")]
    )
    note = forms.CharField(label="审核备注", max_length=1000, required=False)


class PinPostForm(forms.Form):
    pinned = forms.ChoiceField(choices=[("true", "置顶"), ("false", "取消置顶")])


class ReportResolveForm(forms.Form):
    note = forms.CharField(label="处理备注", max_length=1000, required=False)
