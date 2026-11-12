import { isForbiddenIp } from '../src/lib/security/ssrf'
for (const ip of ['64:ff9b::7f00:1','64:ff9b::a00:1','64:ff9b::a9fe:a9fe','2002:7f00:1::1','2002:0a00:1::1','2001:0:1234::1','::127.0.0.1','::a00:1','2607:f8b0:4005:80a::200e','64:ff9b::808:808']) {
  console.log(ip, '→', isForbiddenIp(ip))
}
