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
    WKWebsiteDataStore *store = WKWebsiteDataStore.defaultDataStore;
    NSSet *types = [WKWebsiteDataStore allWebsiteDataTypes];
    [store fetchDataRecordsOfTypes:types completionHandler:^(NSArray<WKWebsiteDataRecord *> *records) {
      NSMutableArray *ours = [NSMutableArray array];
      for (WKWebsiteDataRecord *record in records) {
        if (MWIsAccountDomain(record.displayName)) [ours addObject:record];
      }
      [store removeDataOfTypes:types forDataRecords:ours completionHandler:^{ resolve(@(ours.count)); }];
    }];
  });
}

@end
