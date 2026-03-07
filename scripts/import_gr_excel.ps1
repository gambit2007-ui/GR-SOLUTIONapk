param(
  [string]$SourcePath = "C:\Users\Guilherme\OneDrive - The Mosaic Company\Desktop\GR SOLUTION.xlsm",
  [string]$OutputPath = "C:\GR-SOLUTIONapk\output\spreadsheet\gr-import.json"
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-EntryText {
  param($Zip, [string]$EntryName)
  $e = $Zip.Entries | Where-Object { $_.FullName -eq $EntryName }
  if (-not $e) { return $null }
  $sr = New-Object IO.StreamReader($e.Open())
  try { return $sr.ReadToEnd() } finally { $sr.Dispose() }
}

function CleanText([object]$v) {
  $s = [string]$v
  if ($s -eq 'System.Xml.XmlElement') { return '' }
  return $s.Trim()
}

function ExcelDateToIso([object]$v) {
  if ($null -eq $v -or $v -eq '') { return $null }
  $n = 0.0
  if ([double]::TryParse([string]$v, [ref]$n)) {
    return ([datetime]'1899-12-30').AddDays($n).ToString('yyyy-MM-dd')
  }

  foreach ($fmt in @('dd/MM/yyyy', 'd/M/yyyy', 'yyyy-MM-dd', 'dd\\MM\\yyyy')) {
    $dt = [datetime]::MinValue
    if ([datetime]::TryParseExact([string]$v, $fmt, [cultureinfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$dt)) {
      return $dt.ToString('yyyy-MM-dd')
    }
  }

  return $null
}

function ToNum([object]$v) {
  if ($null -eq $v -or $v -eq '') { return 0.0 }
  $n = 0.0
  if ([double]::TryParse(([string]$v).Replace(',', '.'), [Globalization.NumberStyles]::Any, [cultureinfo]::InvariantCulture, [ref]$n)) {
    return [double]$n
  }
  if ([double]::TryParse([string]$v, [ref]$n)) {
    return [double]$n
  }
  return 0.0
}

function CleanPhone([object]$v) {
  return ([string]$v -replace '\D', '')
}

function MakeId([string]$prefix, [string]$seed) {
  $sha = New-Object Security.Cryptography.SHA1Managed
  $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($seed))).Replace('-', '').ToLower()
  return "$prefix-$($hash.Substring(0, 10))"
}

function ReadSheet {
  param($Zip, [string]$SheetPath, [string[]]$Shared)

  $raw = Get-EntryText -Zip $Zip -EntryName $SheetPath
  if (-not $raw) { return @() }

  $x = [xml]$raw
  $xns = New-Object Xml.XmlNamespaceManager($x.NameTable)
  $xns.AddNamespace('d', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')

  $res = @()
  foreach ($row in $x.SelectNodes('//d:sheetData/d:row', $xns)) {
    $obj = [ordered]@{}

    foreach ($c in $row.SelectNodes('d:c', $xns)) {
      $ref = $c.GetAttribute('r')
      $col = ($ref -replace '\d', '')
      $t = $c.GetAttribute('t')
      $value = ''

      $vNode = $c.SelectSingleNode('d:v', $xns)
      if ($vNode) {
        $rawv = $vNode.InnerText
        if ($t -eq 's') {
          $idx = 0
          [void][int]::TryParse($rawv, [ref]$idx)
          if ($idx -ge 0 -and $idx -lt $Shared.Count) { $value = $Shared[$idx] }
        }
        else {
          $value = $rawv
        }
      }
      else {
        $inlineNode = $c.SelectSingleNode('d:is/d:t', $xns)
        if ($inlineNode) { $value = $inlineNode.InnerText }
      }

      $obj[$col] = CleanText $value
    }

    $res += [pscustomobject]$obj
  }

  return $res
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($SourcePath)
try {
  $workbook = [xml](Get-EntryText -Zip $zip -EntryName 'xl/workbook.xml')
  $rels = [xml](Get-EntryText -Zip $zip -EntryName 'xl/_rels/workbook.xml.rels')

  $sharedRaw = Get-EntryText -Zip $zip -EntryName 'xl/sharedStrings.xml'
  $shared = @()
  if ($sharedRaw) {
    $ss = [xml]$sharedRaw
    foreach ($si in $ss.sst.si) { $shared += $si.InnerText }
  }

  $ns = New-Object Xml.XmlNamespaceManager($workbook.NameTable)
  $ns.AddNamespace('d', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  $rns = New-Object Xml.XmlNamespaceManager($rels.NameTable)
  $rns.AddNamespace('r', 'http://schemas.openxmlformats.org/package/2006/relationships')

  $sheetMap = @{}
  foreach ($sheet in $workbook.SelectNodes('//d:sheets/d:sheet', $ns)) {
    $rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $rel = $rels.SelectSingleNode("//r:Relationship[@Id='$rid']", $rns)
    if ($rel) {
      $target = $rel.GetAttribute('Target')
      $sheetMap[$sheet.GetAttribute('name')] = if ($target.StartsWith('/')) { $target.TrimStart('/') } else { 'xl/' + $target }
    }
  }

  $baseRows = ReadSheet -Zip $zip -SheetPath $sheetMap['Base'] -Shared $shared
  $clientesRows = ReadSheet -Zip $zip -SheetPath $sheetMap['Clientes'] -Shared $shared
  $caixaRows = ReadSheet -Zip $zip -SheetPath $sheetMap['CAIXA'] -Shared $shared

  $customers = @()
  $customerByName = @{}

  for ($i = 2; $i -lt $clientesRows.Count; $i++) {
    $r = $clientesRows[$i]
    $name = CleanText $r.G
    if ([string]::IsNullOrWhiteSpace($name)) { continue }

    $phone = CleanPhone $r.H
    $cpf = ([string](CleanText $r.I) -replace '\D', '')
    $id = MakeId 'cust' ($name + '|' + $phone)

    $cust = [ordered]@{
      id = $id
      name = $name
      cpf = $cpf
      rg = (CleanText $r.J)
      email = (CleanText $r.M)
      phone = $phone
      address = (CleanText $r.K)
      notes = (CleanText $r.U)
      createdAt = [int64]([datetime]::UtcNow.Subtract([datetime]'1970-01-01').TotalMilliseconds)
    }

    $customers += [pscustomobject]$cust
    $customerByName[$name] = $id
  }

  $groups = @{}
  for ($i = 2; $i -lt $baseRows.Count; $i++) {
    $r = $baseRows[$i]
    $code = CleanText $r.B
    if ([string]::IsNullOrWhiteSpace($code)) { continue }

    if (-not $groups.ContainsKey($code)) { $groups[$code] = @() }
    $groups[$code] += $r
  }

  $loans = @()
  $today = (Get-Date).Date

  foreach ($code in $groups.Keys) {
    $rows = @($groups[$code])
    $first = $rows[0]
    $name = CleanText $first.C
    $phone = CleanPhone $first.D

    $customerId = if ($customerByName.ContainsKey($name)) { $customerByName[$name] } else { MakeId 'cust' ($name + '|' + $phone) }

    $amount = 0.0
    $installments = @()

    foreach ($r in $rows) {
      $nparc = CleanText $r.E

      if ($nparc -eq '-') {
        $amount = [Math]::Max($amount, (ToNum $r.O))
        continue
      }

      $num = 0
      if (-not [int]::TryParse($nparc, [ref]$num)) { continue }
      if ($num -le 0) { continue }

      $due = ExcelDateToIso $r.F
      $val = [Math]::Round((ToNum $r.G), 2)
      $statusRaw = (CleanText $r.L).ToUpper()
      $status = if ($statusRaw -match 'PAGO') { 'PAGO' } elseif ($statusRaw -match 'ATRAS') { 'ATRASADO' } else { 'PENDENTE' }

      $inst = [ordered]@{
        id = MakeId 'inst' ($code + '|' + $num)
        number = $num
        dueDate = $due
        value = $val
        status = $status
        originalValue = $val
      }

      if ($status -eq 'PAGO') {
        $inst.lastPaidValue = $val
        if ($due) { $inst.paymentDate = $due }
      }

      $installments += [pscustomobject]$inst
    }

    $installments = @($installments | Sort-Object number)
    if ($installments.Count -eq 0) { continue }

    if ($amount -le 0) {
      $amount = (($rows | ForEach-Object { ToNum $_.H } | Measure-Object -Sum).Sum)
      if ($amount -le 0) {
        $amount = (($installments | ForEach-Object { $_.value } | Measure-Object -Sum).Sum)
      }
    }

    $totalToReturn = (($installments | ForEach-Object { $_.value } | Measure-Object -Sum).Sum)
    $paidAmount = (($installments | Where-Object { $_.status -eq 'PAGO' } | ForEach-Object { $_.value } | Measure-Object -Sum).Sum)
    $interestRate = if ($amount -gt 0) { [Math]::Round((($totalToReturn / $amount) - 1) * 100, 2) } else { 0 }

    $fRaw = (CleanText $first.N).ToUpper()
    $frequency = switch -regex ($fRaw) {
      'SEMAN' { 'SEMANAL' }
      'QUIN' { 'QUINZENAL' }
      'DIA' { 'DIARIO' }
      default { 'MENSAL' }
    }

    $startDate = $installments[0].dueDate
    $dueDate = $installments[0].dueDate

    $hasLate = $false
    foreach ($ins in $installments) {
      if ($ins.status -ne 'PAGO' -and $ins.dueDate) {
        $d = [datetime]::ParseExact($ins.dueDate, 'yyyy-MM-dd', $null)
        if ($d -lt $today) { $hasLate = $true; break }
      }
    }

    $loanStatus = if ([Math]::Abs($totalToReturn - $paidAmount) -le 0.5) { 'QUITADO' } elseif ($hasLate) { 'ATRASADO' } else { 'ATIVO' }

    $loan = [ordered]@{
      id = MakeId 'loan' $code
      contractNumber = $code
      customerId = $customerId
      customerName = $name
      customerPhone = $phone
      amount = [Math]::Round($amount, 2)
      interestRate = $interestRate
      installmentCount = $installments.Count
      frequency = $frequency
      interestType = 'SIMPLES'
      totalToReturn = [Math]::Round($totalToReturn, 2)
      installmentValue = [Math]::Round(($totalToReturn / [Math]::Max(1, $installments.Count)), 2)
      startDate = $startDate
      dueDate = $dueDate
      createdAt = [int64]([datetime]::ParseExact($startDate, 'yyyy-MM-dd', $null).Subtract([datetime]'1970-01-01').TotalMilliseconds)
      installments = @($installments)
      status = $loanStatus
      paidAmount = [Math]::Round($paidAmount, 2)
    }

    $loans += [pscustomobject]$loan
  }

  foreach ($loan in $loans) {
    if (-not ($customers | Where-Object { $_.id -eq $loan.customerId })) {
      $customers += [pscustomobject]@{
        id = $loan.customerId
        name = $loan.customerName
        cpf = ''
        rg = ''
        email = ''
        phone = $loan.customerPhone
        address = ''
        notes = 'Importado da planilha Base'
        createdAt = [int64]([datetime]::UtcNow.Subtract([datetime]'1970-01-01').TotalMilliseconds)
      }
    }
  }

  $caixaAtual = 0.0
  if ($caixaRows.Count -ge 4) {
    $caixaAtual = ToNum $caixaRows[3].C
  }

  $result = [ordered]@{
    sourceFile = $SourcePath
    generatedAt = (Get-Date).ToString('s')
    customers = @($customers)
    loans = @($loans)
    settings = [ordered]@{ caixa = [Math]::Round($caixaAtual, 2) }
  }

  $outDir = Split-Path -Parent $OutputPath
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $result | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

  Write-Output "Generated: $OutputPath"
  Write-Output "Customers: $($customers.Count)"
  Write-Output "Loans: $($loans.Count)"
  Write-Output "Caixa: $caixaAtual"
}
finally {
  $zip.Dispose()
}
