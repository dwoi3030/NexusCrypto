from django.urls import path

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('dashboard/', views.dashboard, name='dashboard'),
    path('login/', views.LoginAccountView.as_view(), name='login'),
    path('account/login/', views.LoginAccountView.as_view(), name='login_account'),
    path('signup/', views.SignupEmailView.as_view(), name='signup_start'),
    path('signup/password/', views.SignupPasswordView.as_view(), name='signup_password'),
    path('signup/verify-otp/', views.SignupVerifyOtpView.as_view(), name='signup_verify_otp'),
    path('signup/resend-otp/', views.SignupResendOtpView.as_view(), name='signup_resend_otp'),
    path('welcome/', views.WelcomeView.as_view(), name='welcome'),
]
