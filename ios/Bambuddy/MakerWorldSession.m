// Reads and clears the MakerWorld sign-in cookie from the WKWebView cookie store.
// The site keeps its Bambu access token in an httpOnly "token" cookie, which
// page JavaScript cannot see, so the in-app sign-in sheet asks native code.

#import <React/RCTBridgeModule.h>
#import <WebKit/WebKit.h>

@interface MakerWorldSession : NSObject <RCTBridgeModule>
@end

static BOOL MWIsAccountDomain(NSString *domain) {
  NSString *d = domain.lowercaseString;
  if ([d hasPrefix:@"."]) d = [d substringFromIndex:1];
  for (NSString *root in @[@"makerworld.com", @"bambulab.com"]) {
    if ([d isEqualToString:root] || [d hasSuffix:[@"." stringByAppendingString:root]]) return YES;
  }
  return NO;
}

@implementation MakerWorldSession

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup { return NO; }

RCT_EXPORT_METHOD(readToken:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    WKHTTPCookieStore *store = WKWebsiteDataStore.defaultDataStore.httpCookieStore;
    [store getAllCookies:^(NSArray<NSHTTPCookie *> *cookies) {
      NSHTTPCookie *best = nil;
      for (NSHTTPCookie *cookie in cookies) {
        if (![cookie.name isEqualToString:@"token"] || !MWIsAccountDomain(cookie.domain) || cookie.value.length < 16) continue;
        if (cookie.expiresDate && cookie.expiresDate.timeIntervalSinceNow <= 0) continue;
        // Prefer the MakerWorld cookie over a bambulab.com one.
        if (!best || [cookie.domain.lowercaseString containsString:@"makerworld"]) best = cookie;
      }
      if (!best) { resolve([NSNull null]); return; }
      NSMutableDictionary *result = [@{@"token": best.value, @"domain": best.domain} mutableCopy];
      if (best.expiresDate) result[@"expiresAt"] = @(best.expiresDate.timeIntervalSince1970 * 1000);
      resolve(result);
    }];
  });
}

RCT_EXPORT_METHOD(clear:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    // The app-wide cookie jar may hold a copy of the session (WebViews with shared
    // cookies sync into it), which would sign the user straight back in.
    NSHTTPCookieStorage *jar = NSHTTPCookieStorage.sharedHTTPCookieStorage;
    for (NSHTTPCookie *cookie in [jar.cookies copy]) {
      if (MWIsAccountDomain(cookie.domain)) [jar deleteCookie:cookie];
    }
    WKWebsiteDataStore *store = WKWebsiteDataStore.defaultDataStore;
    WKHTTPCookieStore *cookieStore = store.httpCookieStore;
    // Delete the WebView cookies explicitly, then the rest of the site data.
    [cookieStore getAllCookies:^(NSArray<NSHTTPCookie *> *cookies) {
      dispatch_group_t group = dispatch_group_create();
      __block NSUInteger removed = 0;
      for (NSHTTPCookie *cookie in cookies) {
        if (!MWIsAccountDomain(cookie.domain)) continue;
        removed++;
        dispatch_group_enter(group);
        [cookieStore deleteCookie:cookie completionHandler:^{ dispatch_group_leave(group); }];
      }
      dispatch_group_notify(group, dispatch_get_main_queue(), ^{
        NSSet *types = [WKWebsiteDataStore allWebsiteDataTypes];
        [store fetchDataRecordsOfTypes:types completionHandler:^(NSArray<WKWebsiteDataRecord *> *records) {
          NSMutableArray *ours = [NSMutableArray array];
          for (WKWebsiteDataRecord *record in records) {
            if (MWIsAccountDomain(record.displayName)) [ours addObject:record];
          }
          [store removeDataOfTypes:types forDataRecords:ours completionHandler:^{ resolve(@(removed)); }];
        }];
      });
    }];
  });
}

@end
