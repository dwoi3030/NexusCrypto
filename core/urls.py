from django.urls import path

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('login/', views.SignupEmailView.as_view(), name='login'),
    path('signup/password/', views.SignupPasswordView.as_view(), name='signup_password'),
    path('signup/verify-otp/', views.SignupVerifyOtpView.as_view(), name='signup_verify_otp'),
    path('signup/resend-otp/', views.SignupResendOtpView.as_view(), name='signup_resend_otp'),
    path('welcome/', views.WelcomeView.as_view(), name='welcome'),
]
