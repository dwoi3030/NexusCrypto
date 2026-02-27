from django.urls import path

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('overview/', views.overview, name='overview'),
    path('dashboard/', views.dashboard, name='dashboard'),
    path('wallet/fiat-spot/', views.fiat_spot, name='fiat_spot'),
    path('dashboard/trade-history/', views.trade_history, name='trade_history'),
    path('api/market/ohlcv/', views.market_ohlcv, name='market_ohlcv'),
    path('api/market/price/', views.market_price, name='market_price'),
    path('api/market/top-assets/', views.top_assets, name='top_assets'),
    path('login/', views.LoginAccountView.as_view(), name='login'),
    path('account/login/', views.LoginAccountView.as_view(), name='login_account'),
    path('wallet/deposit/', views.DepositView.as_view(), name='deposit'),
    path('signup/', views.SignupEmailView.as_view(), name='signup_start'),
    path('signup/password/', views.SignupPasswordView.as_view(), name='signup_password'),
    path('signup/verify-otp/', views.SignupVerifyOtpView.as_view(), name='signup_verify_otp'),
    path('signup/resend-otp/', views.SignupResendOtpView.as_view(), name='signup_resend_otp'),
    path('welcome/', views.WelcomeView.as_view(), name='welcome'),
]
